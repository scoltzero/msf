package server

import (
	"bufio"
	"context"
	"encoding/binary"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type localLoopCheck struct {
	Key        string `json:"key"`
	Module     string `json:"module"`
	ModuleName string `json:"module_name"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	Message    string `json:"message"`
	Expected   string `json:"expected,omitempty"`
	Actual     string `json:"actual,omitempty"`
	Evidence   string `json:"evidence,omitempty"`
	Blocking   bool   `json:"blocking,omitempty"`
}

type localLoopTopology struct {
	Mode          string `json:"mode"`
	ProxyCore     string `json:"proxy_core"`
	MosDNSEnabled bool   `json:"mosdns_enabled"`
	Interface     string `json:"interface"`
	IPv6Enabled   bool   `json:"ipv6_enabled"`
	AutoDNS       bool   `json:"auto_dns"`
	Runtime       string `json:"runtime"`
}

type localLoopResult struct {
	Success       bool              `json:"success"`
	OverallStatus string            `json:"overall_status"`
	Conclusion    string            `json:"conclusion"`
	ScopeNote     string            `json:"scope_note"`
	Topology      localLoopTopology `json:"topology"`
	Checks        []localLoopCheck  `json:"checks"`
}

type localLoopEmitter func(localLoopCheck)

func passedCheck(key, module, moduleName, name, message string) localLoopCheck {
	return localLoopCheck{Key: key, Module: module, ModuleName: moduleName, Name: name, Status: "passed", Message: message}
}

func blockedCheck(key, module, moduleName, name, message, expected, actual, evidence string) localLoopCheck {
	return localLoopCheck{Key: key, Module: module, ModuleName: moduleName, Name: name, Status: "blocked", Message: message, Expected: expected, Actual: actual, Evidence: evidence, Blocking: true}
}

func warningCheck(key, module, moduleName, name, message, evidence string) localLoopCheck {
	return localLoopCheck{Key: key, Module: module, ModuleName: moduleName, Name: name, Status: "warning", Message: message, Evidence: evidence}
}

func notApplicableCheck(key, module, moduleName, name, message string) localLoopCheck {
	return localLoopCheck{Key: key, Module: module, ModuleName: moduleName, Name: name, Status: "not_applicable", Message: message}
}

func (a *App) runLocalLoopDiagnostics(ctx context.Context, emit localLoopEmitter) localLoopResult {
	cfg, ok := a.latestSetupConfig()
	if !ok {
		cfg = SetupConfig{}
	}
	cfg.defaults()
	topology := localLoopTopology{
		Mode:          strings.ToLower(strings.TrimSpace(cfg.LinuxProxyMode)),
		ProxyCore:     strings.ToLower(strings.TrimSpace(cfg.ProxyCore)),
		MosDNSEnabled: cfg.MosDNSEnabled,
		Interface:     cfg.SelectedInterface,
		IPv6Enabled:   cfg.EnableIPv6,
		AutoDNS:       cfg.AutoSetDNS,
		Runtime:       runtime.GOOS,
	}
	if IsDockerRuntime() {
		topology.Runtime = "docker"
	} else if IsMacOSRuntime() {
		topology.Runtime = "macos"
	}

	result := localLoopResult{
		Success:   true,
		Topology:  topology,
		ScopeNote: "本结论只验证 MSF 所在主机的本地 DNS、代理核心和透明转发回路；未验证公网出口、代理节点、主路由或其他局域网设备。",
	}
	add := func(check localLoopCheck) {
		if ctx.Err() != nil {
			return
		}
		result.Checks = append(result.Checks, check)
		if emit != nil {
			emit(check)
		}
	}

	if !ok {
		add(blockedCheck("topology.setup", "topology", "回路拓扑", "运行拓扑", "找不到已保存的初始化配置，无法确定本机回路。", "存在初始化配置", "不存在", "system_setups 没有可用记录"))
		result.Success = false
		result.OverallStatus = "blocked"
		result.Conclusion = "无法确定本机转发回路"
		return result
	} else if err := validateSetupProxyMode(cfg); err != nil {
		add(blockedCheck("topology.mode", "topology", "回路拓扑", "代理模式", "当前平台与代理模式不兼容。", "平台支持的唯一代理模式", topology.Mode, err.Error()))
	} else {
		add(passedCheck("topology.mode", "topology", "回路拓扑", "代理模式", fmt.Sprintf("已确定本机使用 %s / %s 回路。", topology.ProxyCore, topology.Mode)))
	}

	add(a.checkLocalInterface(cfg))
	add(a.checkLocalSystemDNS(cfg))
	add(a.checkLocalDNSLoop(cfg))

	if cfg.MosDNSEnabled {
		add(a.checkMosDNSRuntime(ctx))
		add(a.checkMosDNSConfig())
		add(a.checkMosDNSControlPlane())
		add(a.checkMosDNSLocalDataPlane(ctx))
	} else {
		add(notApplicableCheck("mosdns.disabled", "mosdns", "MosDNS 本机处理链", "MosDNS", "当前配置未启用 MosDNS，本模块不执行 MosDNS 回路检查。"))
	}

	if strings.EqualFold(cfg.ProxyCore, "mihomo") {
		mihomoCfg, configErr := a.readActiveMihomoConfig()
		add(a.checkMihomoRuntime(ctx, mihomoCfg, configErr))
		add(a.checkDNSHandoff(ctx, mihomoCfg, configErr))
		add(a.checkFakeIPConsistency(cfg, mihomoCfg, configErr))
		add(a.checkMihomoController())
		if isTUNProxyMode(cfg.LinuxProxyMode) {
			add(a.checkTUNModeIdentity(cfg))
			add(a.checkTUNInterface(cfg))
			add(a.checkTUNFakeIPRoute(ctx, cfg))
		} else {
			add(a.checkNFTModeIdentity(cfg))
			add(a.checkNFTTCPOutput(ctx, cfg, mihomoCfg))
			add(a.checkNFTUDPOutput(ctx, cfg, mihomoCfg))
			add(a.checkMarkedRouteLookup(ctx, cfg))
		}
	} else if strings.EqualFold(cfg.ProxyCore, "singbox") || strings.EqualFold(cfg.ProxyCore, "sing-box") {
		add(blockedCheck("proxy.unsupported", "proxy", "代理核心", "代理核心支持状态", "当前配置选择了 Sing-box，但此构建尚未支持该本机代理回路。", "受支持的已启用代理核心", cfg.ProxyCore, "managedServiceNames 当前仅包含 mosdns 与 mihomo"))
	} else {
		add(notApplicableCheck("proxy.disabled", "proxy", "代理核心", "代理核心", "当前配置没有启用代理核心。"))
	}
	add(a.checkNetworkTransitionState())

	blocked := 0
	warnings := 0
	for _, check := range result.Checks {
		switch check.Status {
		case "blocked":
			blocked++
		case "warning":
			warnings++
		}
	}
	switch {
	case ctx.Err() != nil:
		result.Success = false
		result.OverallStatus = "cancelled"
		result.Conclusion = "本机回路检查已取消"
	case blocked > 0:
		result.Success = false
		result.OverallStatus = "blocked"
		result.Conclusion = fmt.Sprintf("本机转发回路存在 %d 处阻断", blocked)
	case warnings > 0:
		result.OverallStatus = "warning"
		result.Conclusion = fmt.Sprintf("本机回路结构已就绪，存在 %d 项风险", warnings)
	default:
		result.OverallStatus = "ready"
		result.Conclusion = "本机转发回路已正确建立"
	}
	return result
}

func (a *App) checkLocalInterface(cfg SetupConfig) localLoopCheck {
	name := strings.TrimSpace(cfg.SelectedInterface)
	if name == "" {
		return blockedCheck("entry.interface", "entry", "本机入口与系统 DNS", "物理出口网卡", "没有配置本机物理出口网卡。", "存在选定网卡", "空", "selected_interface 为空")
	}
	iface, err := net.InterfaceByName(name)
	if err != nil {
		return blockedCheck("entry.interface", "entry", "本机入口与系统 DNS", "物理出口网卡", "配置的物理出口网卡不存在。", name+" 存在且 UP", "不存在", err.Error())
	}
	addrs, _ := iface.Addrs()
	if iface.Flags&net.FlagUp == 0 || len(addrs) == 0 {
		return blockedCheck("entry.interface", "entry", "本机入口与系统 DNS", "物理出口网卡", "物理出口网卡没有处于可用状态。", name+" 为 UP 且拥有地址", iface.Flags.String(), fmt.Sprint(addrs))
	}
	return passedCheck("entry.interface", "entry", "本机入口与系统 DNS", "物理出口网卡", fmt.Sprintf("%s 已启用并拥有 %d 个地址。", name, len(addrs)))
}

func (a *App) checkLocalSystemDNS(cfg SetupConfig) localLoopCheck {
	if !cfg.AutoSetDNS {
		return notApplicableCheck("entry.system_dns", "entry", "本机入口与系统 DNS", "本机 DNS 接管", "自动设置系统 DNS 已关闭，不要求本机 resolver 指向 MosDNS。")
	}
	if runtime.GOOS != "linux" {
		return warningCheck("entry.system_dns", "entry", "本机入口与系统 DNS", "本机 DNS 接管", "当前平台暂时只能验证配置目标，无法在纯读取模式下统一解析系统 resolver。", runtime.GOOS)
	}
	raw, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return blockedCheck("entry.system_dns", "entry", "本机入口与系统 DNS", "本机 DNS 接管", "无法读取本机 resolver 配置。", cfg.DNSOn, "不可读", err.Error())
	}
	nameservers := resolverNameservers(string(raw))
	want := strings.TrimSpace(cfg.DNSOn)
	for _, item := range nameservers {
		if item == want || (isLocalDNSAddress(want) && isLocalDNSAddress(item)) {
			return passedCheck("entry.system_dns", "entry", "本机入口与系统 DNS", "本机 DNS 接管", "本机 resolver 已指向 MosDNS。")
		}
	}
	return blockedCheck("entry.system_dns", "entry", "本机入口与系统 DNS", "本机 DNS 接管", "自动 DNS 已启用，但本机 resolver 没有进入 MosDNS。", want, strings.Join(nameservers, ", "), string(raw))
}

func resolverNameservers(text string) []string {
	var out []string
	scanner := bufio.NewScanner(strings.NewReader(text))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 && strings.EqualFold(fields[0], "nameserver") {
			out = append(out, strings.Trim(fields[1], "[]"))
		}
	}
	return out
}

func isLocalDNSAddress(value string) bool {
	value = strings.Trim(strings.TrimSpace(value), "[]")
	return value == "127.0.0.1" || value == "::1" || value == "localhost"
}

func (a *App) checkLocalDNSLoop(cfg SetupConfig) localLoopCheck {
	mosdns, err := os.ReadFile(filepath.Join(a.DataDir, mosDNSConfigPath))
	if err != nil {
		return warningCheck("entry.dns_loop", "entry", "本机入口与系统 DNS", "本机 DNS 递归自环", "无法读取 MosDNS 生效配置来分析本地 DNS 关系。", err.Error())
	}
	mihomo := a.mihomoConfigMap()
	dns, _ := mihomo["dns"].(map[string]any)
	defaultNS := strings.Join(yamlStrings(dns["default-nameserver"]), ",")
	mosText := string(mosdns)
	if strings.Contains(mosText, "127.0.0.1:6666") && strings.Contains(defaultNS, "127.0.0.1:53") {
		return blockedCheck("entry.dns_loop", "entry", "本机入口与系统 DNS", "本机 DNS 递归自环", "MosDNS 与 Mihomo DNS 形成了本地递归环。", "Mihomo default-nameserver 使用独立终止节点", defaultNS, "MosDNS -> 127.0.0.1:6666 -> Mihomo -> 127.0.0.1:53 -> MosDNS")
	}
	return passedCheck("entry.dns_loop", "entry", "本机入口与系统 DNS", "本机 DNS 递归自环", "没有发现 MosDNS 与 Mihomo 之间的直接本地递归环。")
}

func (a *App) checkMosDNSRuntime(ctx context.Context) localLoopCheck {
	service := a.Services.Status("mosdns")
	listeners := collectSetupPortListeners(ctx, []int{53})
	tcpOK := listenerOwnedByService(listeners, 53, "tcp", service)
	udpOK := listenerOwnedByService(listeners, 53, "udp", service)
	if service.Running && tcpOK && udpOK {
		return passedCheck("mosdns.runtime", "mosdns", "MosDNS 本机处理链", "MosDNS 运行身份", "MosDNS 正在运行，并由同一实例持有 TCP/UDP 53。")
	}
	return blockedCheck("mosdns.runtime", "mosdns", "MosDNS 本机处理链", "MosDNS 运行身份", "本机 DNS 入口没有由预期 MosDNS 实例完整持有。", "MosDNS 运行且持有 TCP/UDP 53", fmt.Sprintf("running=%t tcp=%t udp=%t pid=%d", service.Running, tcpOK, udpOK, service.PID), fmt.Sprint(listeners))
}

func (a *App) checkMosDNSConfig() localLoopCheck {
	path := filepath.Join(a.DataDir, mosDNSConfigPath)
	raw, err := os.ReadFile(path)
	if err != nil {
		return blockedCheck("mosdns.config", "mosdns", "MosDNS 本机处理链", "MosDNS 生效配置", "无法读取 MosDNS 生效配置。", path, "不可读", err.Error())
	}
	var cfg map[string]any
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return blockedCheck("mosdns.config", "mosdns", "MosDNS 本机处理链", "MosDNS 生效配置", "MosDNS 生效配置无法解析。", "有效 YAML", "解析失败", err.Error())
	}
	text := string(raw)
	if !strings.Contains(text, "listen: \":53\"") || !strings.Contains(text, "entry: sequence_6666") {
		return blockedCheck("mosdns.config", "mosdns", "MosDNS 本机处理链", "MosDNS 生效配置", "本机 :53 入口没有连接到主处理序列。", ":53 -> sequence_6666", "未找到完整关系", path)
	}
	return passedCheck("mosdns.config", "mosdns", "MosDNS 本机处理链", "MosDNS 生效配置", "本机 :53 入口和主处理序列结构完整。")
}

func (a *App) checkMosDNSControlPlane() localLoopCheck {
	if !isLocalHTTPURL(a.mosDNSAPIBase()) {
		return blockedCheck("mosdns.control", "mosdns", "MosDNS 本机处理链", "MosDNS 本地控制面", "MosDNS API 被配置为非本机地址，本机诊断拒绝访问。", "loopback/localhost API", a.mosDNSAPIBase(), "诊断不会向远端发送请求")
	}
	if _, ok := a.mosDNSProxyMetrics(); ok {
		return passedCheck("mosdns.control", "mosdns", "MosDNS 本机处理链", "MosDNS 本地控制面", "MosDNS 本地 metrics 接口可读取。")
	}
	return blockedCheck("mosdns.control", "mosdns", "MosDNS 本机处理链", "MosDNS 本地控制面", "MosDNS 进程存在，但本地 metrics 接口没有返回有效数据。", a.mosDNSAPIURL("/metrics"), "无有效响应", "只请求本机接口，未访问公网")
}

func isLocalHTTPURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "localhost" || host == "0.0.0.0" || host == "::" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (a *App) checkMosDNSLocalDataPlane(ctx context.Context) localLoopCheck {
	switchValue, err := os.ReadFile(filepath.Join(a.DataDir, "configs/mosdns/rule/switch1.txt"))
	if err != nil || !strings.EqualFold(strings.TrimSpace(string(switchValue)), "A") {
		return warningCheck("mosdns.data_plane", "mosdns", "MosDNS 本机处理链", "MosDNS 本地 DNS 数据面", "当前没有启用可保证本地终止的屏蔽规则，因此不发送可能访问上游的探针。", "switch1 未启用或不可读；本次诊断保持纯本地")
	}
	blocklist, err := os.ReadFile(filepath.Join(a.DataDir, "configs/mosdns/rule/blocklist.txt"))
	if err != nil {
		return warningCheck("mosdns.data_plane", "mosdns", "MosDNS 本机处理链", "MosDNS 本地 DNS 数据面", "无法选择一个确定由本机规则处理的探针域名。", err.Error())
	}
	domain := firstLocalProbeDomain(string(blocklist))
	if domain == "" {
		return warningCheck("mosdns.data_plane", "mosdns", "MosDNS 本机处理链", "MosDNS 本地 DNS 数据面", "屏蔽规则为空，无法执行不会访问上游的 DNS 探针。", "没有安全探针目标")
	}
	if err := localDNSQuery(ctx, "127.0.0.1:53", domain); err != nil {
		return blockedCheck("mosdns.data_plane", "mosdns", "MosDNS 本机处理链", "MosDNS 本地 DNS 数据面", "本机 DNS 请求没有得到有效 MosDNS 响应。", "从本地屏蔽规则得到 DNS 响应", "请求失败", err.Error())
	}
	return passedCheck("mosdns.data_plane", "mosdns", "MosDNS 本机处理链", "MosDNS 本地 DNS 数据面", "本机 DNS 请求已由 MosDNS 的本地规则处理，未访问远端上游。")
}

func firstLocalProbeDomain(text string) string {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(strings.SplitN(line, "#", 2)[0])
		line = strings.TrimPrefix(line, "full:")
		line = strings.TrimPrefix(line, "domain:")
		line = strings.TrimSuffix(line, ".")
		if strings.Count(line, ".") >= 1 && len(line) <= 253 {
			return line
		}
	}
	return ""
}

func localDNSQuery(ctx context.Context, address, domain string) error {
	dialer := net.Dialer{Timeout: 500 * time.Millisecond}
	conn, err := dialer.DialContext(ctx, "udp", address)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(time.Second))
	id := uint16(time.Now().UnixNano())
	packet := make([]byte, 12, 512)
	binary.BigEndian.PutUint16(packet[0:2], id)
	binary.BigEndian.PutUint16(packet[2:4], 0x0100)
	binary.BigEndian.PutUint16(packet[4:6], 1)
	for _, label := range strings.Split(domain, ".") {
		if len(label) == 0 || len(label) > 63 {
			return fmt.Errorf("invalid DNS label in %q", domain)
		}
		packet = append(packet, byte(len(label)))
		packet = append(packet, label...)
	}
	packet = append(packet, 0, 0, 1, 0, 1)
	if _, err := conn.Write(packet); err != nil {
		return err
	}
	response := make([]byte, 2048)
	n, err := conn.Read(response)
	if err != nil {
		return err
	}
	if n < 12 || binary.BigEndian.Uint16(response[:2]) != id || binary.BigEndian.Uint16(response[2:4])&0x8000 == 0 {
		return fmt.Errorf("invalid DNS response")
	}
	return nil
}

func (a *App) readActiveMihomoConfig() (map[string]any, error) {
	path := filepath.Join(a.DataDir, mihomoActiveConfigRelPath)
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg map[string]any
	err = yaml.Unmarshal(raw, &cfg)
	return cfg, err
}

func (a *App) checkMihomoRuntime(ctx context.Context, cfg map[string]any, configErr error) localLoopCheck {
	if configErr != nil {
		return blockedCheck("mihomo.runtime", "mihomo", "Mihomo 本机代理链", "Mihomo 运行身份", "Mihomo 生效配置不可用。", "有效生效配置", "不可用", configErr.Error())
	}
	service := a.Services.Status("mihomo")
	ports := mihomoPortsFromConfig(cfg)
	listeners := collectSetupPortListeners(ctx, []int{ports["dns"], ports["controller"]})
	if service.Running && listenerOwnedByService(listeners, ports["dns"], "", service) {
		return passedCheck("mihomo.runtime", "mihomo", "Mihomo 本机代理链", "Mihomo 运行身份", "Mihomo 正在运行，并持有生效配置中的 DNS 监听。")
	}
	return blockedCheck("mihomo.runtime", "mihomo", "Mihomo 本机代理链", "Mihomo 运行身份", "Mihomo 没有建立本机代理 DNS 入口。", fmt.Sprintf("pid=%d dns=%d", service.PID, ports["dns"]), fmt.Sprintf("running=%t", service.Running), fmt.Sprint(listeners))
}

func (a *App) checkDNSHandoff(ctx context.Context, cfg map[string]any, configErr error) localLoopCheck {
	if configErr != nil {
		return blockedCheck("mihomo.handoff", "mihomo", "Mihomo 本机代理链", "MosDNS 到 Mihomo DNS 交接", "无法从 Mihomo 生效配置确定 DNS 下一跳。", "MosDNS 与 Mihomo 使用相同 DNS 端口", "未知", configErr.Error())
	}
	ports := mihomoPortsFromConfig(cfg)
	mosRaw, err := os.ReadFile(filepath.Join(a.DataDir, "configs/mosdns/sub_config/forward_1.yaml"))
	if err != nil {
		return blockedCheck("mihomo.handoff", "mihomo", "Mihomo 本机代理链", "MosDNS 到 Mihomo DNS 交接", "无法读取 MosDNS 的代理 DNS 下一跳。", strconv.Itoa(ports["dns"]), "不可读", err.Error())
	}
	want := ":" + strconv.Itoa(ports["dns"])
	if !strings.Contains(string(mosRaw), want) {
		return blockedCheck("mihomo.handoff", "mihomo", "Mihomo 本机代理链", "MosDNS 到 Mihomo DNS 交接", "MosDNS 下一跳与 Mihomo DNS 监听不一致。", "127.0.0.1"+want, "forward_1.yaml 未指向该端口", string(mosRaw))
	}
	service := a.Services.Status("mihomo")
	listeners := collectSetupPortListeners(ctx, []int{ports["dns"]})
	if !listenerOwnedByService(listeners, ports["dns"], "", service) {
		return blockedCheck("mihomo.handoff", "mihomo", "Mihomo 本机代理链", "MosDNS 到 Mihomo DNS 交接", "配置关系正确，但下一跳没有由 Mihomo 持有。", "Mihomo 监听 "+want, "监听身份不匹配", fmt.Sprint(listeners))
	}
	return passedCheck("mihomo.handoff", "mihomo", "Mihomo 本机代理链", "MosDNS 到 Mihomo DNS 交接", "MosDNS 下一跳与 Mihomo DNS 监听一致。")
}

func (a *App) checkFakeIPConsistency(cfg SetupConfig, mihomo map[string]any, configErr error) localLoopCheck {
	if configErr != nil {
		return blockedCheck("mihomo.fakeip", "mihomo", "Mihomo 本机代理链", "Fake-IP 参数一致性", "无法读取 Mihomo Fake-IP 配置。", fakeIPv4RouteCIDR(cfg.FakeIPRangeV4), "未知", configErr.Error())
	}
	dns, _ := mihomo["dns"].(map[string]any)
	actualV4 := fakeIPv4RouteCIDR(fmtAny(dns["fake-ip-range"]))
	wantV4 := fakeIPv4RouteCIDR(cfg.FakeIPRangeV4)
	if actualV4 != wantV4 {
		return blockedCheck("mihomo.fakeip", "mihomo", "Mihomo 本机代理链", "Fake-IP 参数一致性", "Mihomo 与 MSF 设置使用了不同的 IPv4 Fake-IP 网段。", wantV4, actualV4, "dns.fake-ip-range")
	}
	if cfg.EnableIPv6 {
		actualV6 := fakeIPv6RouteCIDR(fmtAny(dns["fake-ip-range6"]))
		wantV6 := fakeIPv6RouteCIDR(cfg.FakeIPRangeV6)
		if actualV6 != wantV6 {
			return blockedCheck("mihomo.fakeip", "mihomo", "Mihomo 本机代理链", "Fake-IP 参数一致性", "Mihomo 与 MSF 设置使用了不同的 IPv6 Fake-IP 网段。", wantV6, actualV6, "dns.fake-ip-range6")
		}
	}
	return passedCheck("mihomo.fakeip", "mihomo", "Mihomo 本机代理链", "Fake-IP 参数一致性", "当前启用协议族的 Fake-IP 范围一致。")
}

func (a *App) checkMihomoController() localLoopCheck {
	if !isLocalHTTPURL(a.mihomoControllerBase()) {
		return blockedCheck("mihomo.controller", "mihomo", "Mihomo 本机代理链", "Mihomo 本地控制面", "Mihomo Controller 被配置为非本机地址，本机诊断拒绝访问。", "loopback/localhost Controller", a.mihomoControllerBase(), "诊断不会向远端发送请求")
	}
	if _, ok, err := a.mihomoControllerJSON(http.MethodGet, "/version", nil); ok {
		return passedCheck("mihomo.controller", "mihomo", "Mihomo 本机代理链", "Mihomo 本地控制面", "Mihomo Controller 可响应，当前实例已加载运行配置。")
	} else {
		evidence := "本机 Controller 没有有效响应"
		if err != nil {
			evidence = err.Error()
		}
		return blockedCheck("mihomo.controller", "mihomo", "Mihomo 本机代理链", "Mihomo 本地控制面", "Mihomo 进程无法通过本地 Controller 证明其运行配置。", a.mihomoControllerURL("/version"), "不可用", evidence)
	}
}

func (a *App) checkNFTModeIdentity(cfg SetupConfig) localLoopCheck {
	if err := a.validateGeneratedProxyModeFiles(cfg); err != nil {
		return blockedCheck("nft.identity", "nft", "本机 nftables 回路", "nft 模式身份", "生效配置混用了 TUN/nft，或缺少 nft 模式文件。", "纯 nft/tproxy 模式", cfg.LinuxProxyMode, err.Error())
	}
	return passedCheck("nft.identity", "nft", "本机 nftables 回路", "nft 模式身份", "Mihomo、network.yaml 与 network.nft 的模式一致。")
}

func (a *App) checkNFTTCPOutput(ctx context.Context, cfg SetupConfig, mihomo map[string]any) localLoopCheck {
	out, err := combinedOutputWithTimeout(ctx, 3*time.Second, "nft", "list", "table", "inet", "msf")
	if err != nil {
		return blockedCheck("nft.tcp_output", "nft", "本机 nftables 回路", "本机 TCP OUTPUT 回路", "MSF nftables 表没有加载。", "table inet msf 含 nat-output", "不可读取", err.Error())
	}
	ports := mihomoPortsFromConfig(mihomo)
	text := string(out)
	if !strings.Contains(text, "chain nat-output") || !strings.Contains(text, "redirect to :"+strconv.Itoa(ports["redir"])) || !strings.Contains(text, fakeIPv4RouteCIDR(cfg.FakeIPRangeV4)) {
		return blockedCheck("nft.tcp_output", "nft", "本机 nftables 回路", "本机 TCP OUTPUT 回路", "当前内核规则没有把本机 Fake-IP TCP 流量送入 Mihomo redir。", fmt.Sprintf("nat-output -> :%d, fake=%s", ports["redir"], fakeIPv4RouteCIDR(cfg.FakeIPRangeV4)), "规则不完整", text)
	}
	return passedCheck("nft.tcp_output", "nft", "本机 nftables 回路", "本机 TCP OUTPUT 回路", "本机 Fake-IP TCP OUTPUT 已连接到 Mihomo redir。")
}

func (a *App) checkNFTUDPOutput(ctx context.Context, cfg SetupConfig, mihomo map[string]any) localLoopCheck {
	ports := mihomoPortsFromConfig(mihomo)
	service := a.Services.Status("mihomo")
	listeners := collectSetupPortListeners(ctx, []int{ports["tproxy"]})
	nftOut, nftErr := combinedOutputWithTimeout(ctx, 3*time.Second, "nft", "list", "table", "inet", "msf")
	ruleOut, ruleErr := combinedOutputWithTimeout(ctx, 3*time.Second, "ip", "rule", "show")
	routeOut, routeErr := combinedOutputWithTimeout(ctx, 3*time.Second, "ip", "route", "show", "table", "100")
	markLoaded := strings.Contains(string(nftOut), "meta mark set 0x1") || strings.Contains(string(nftOut), "meta mark set 0x00000001") || strings.Contains(string(nftOut), "meta mark set 1")
	ok := nftErr == nil && strings.Contains(string(nftOut), "chain mangle-output") && markLoaded
	ok = ok && ruleErr == nil && containsManagedPolicyRule(string(ruleOut)) && routeErr == nil && containsManagedLocalRoute(string(routeOut)) && listenerOwnedByService(listeners, ports["tproxy"], "", service)
	if !ok {
		return blockedCheck("nft.udp_output", "nft", "本机 nftables 回路", "本机 UDP OUTPUT 回路", "本机 UDP 的 mark、表 100、本地路由或 TProxy 监听不完整。", fmt.Sprintf("mark 1 -> table 100 -> lo -> :%d", ports["tproxy"]), "链路不完整", strings.Join([]string{string(nftOut), string(ruleOut), string(routeOut), fmt.Sprint(listeners)}, "\n"))
	}
	return passedCheck("nft.udp_output", "nft", "本机 nftables 回路", "本机 UDP OUTPUT 回路", "本机 UDP OUTPUT 已连接到 mark 1、table 100 和 Mihomo TProxy。")
}

func (a *App) checkMarkedRouteLookup(ctx context.Context, cfg SetupConfig) localLoopCheck {
	out, err := combinedOutputWithTimeout(ctx, 3*time.Second, "ip", "route", "get", "192.0.2.1", "mark", "1")
	if err != nil {
		return blockedCheck("nft.route_lookup", "nft", "本机 nftables 回路", "本机策略路由干运行", "内核无法计算 mark 1 的本机策略路由。", "命中 table 100 的 local lo", "查询失败", err.Error())
	}
	text := strings.ToLower(string(out))
	if !strings.Contains(text, "dev lo") && !strings.Contains(text, "local") {
		return blockedCheck("nft.route_lookup", "nft", "本机 nftables 回路", "本机策略路由干运行", "mark 1 没有进入本地 lo 路由。", "local ... dev lo", strings.TrimSpace(string(out)), "ip route get 只计算路由，未发送数据包")
	}
	return passedCheck("nft.route_lookup", "nft", "本机 nftables 回路", "本机策略路由干运行", "mark 1 的内核路由计算会进入本地 lo。")
}

func (a *App) checkTUNModeIdentity(cfg SetupConfig) localLoopCheck {
	if err := a.validateGeneratedProxyModeFiles(cfg); err != nil {
		return blockedCheck("tun.identity", "tun", "本机 TUN 回路", "TUN 模式身份", "生效配置没有形成纯 TUN 模式。", "tun.enable + auto-route，且无 MSF nft", cfg.LinuxProxyMode, err.Error())
	}
	if out, err := combinedOutputWithTimeout(context.Background(), 2*time.Second, "nft", "list", "table", "inet", "msf"); err == nil && len(out) > 0 {
		return blockedCheck("tun.identity", "tun", "本机 TUN 回路", "TUN 模式身份", "TUN 模式仍残留已加载的 MSF nftables 表。", "不存在 table inet msf", "仍存在", string(out))
	}
	return passedCheck("tun.identity", "tun", "本机 TUN 回路", "TUN 模式身份", "当前配置只启用 TUN，没有混用 MSF nftables。")
}

func (a *App) checkTUNInterface(cfg SetupConfig) localLoopCheck {
	var candidates []net.Interface
	interfaces, _ := net.Interfaces()
	for _, iface := range interfaces {
		name := strings.ToLower(iface.Name)
		if name == "mihomo" || (IsMacOSRuntime() && strings.HasPrefix(name, "utun")) {
			candidates = append(candidates, iface)
		}
	}
	for _, iface := range candidates {
		if iface.Flags&net.FlagUp != 0 {
			return passedCheck("tun.interface", "tun", "本机 TUN 回路", "TUN 接口运行状态", "Mihomo 已建立并启用本机 TUN 接口 "+iface.Name+"。")
		}
	}
	names := make([]string, 0, len(candidates))
	for _, iface := range candidates {
		names = append(names, iface.Name+":"+iface.Flags.String())
	}
	return blockedCheck("tun.interface", "tun", "本机 TUN 回路", "TUN 接口运行状态", "配置启用了 TUN，但没有找到处于 UP 状态的 Mihomo TUN 接口。", "mihomo 或当前 utunN 为 UP", strings.Join(names, ", "), runtime.GOOS)
}

func (a *App) checkTUNFakeIPRoute(ctx context.Context, cfg SetupConfig) localLoopCheck {
	prefix := fakeIPv4RouteCIDR(cfg.FakeIPRangeV4)
	ip, _, err := net.ParseCIDR(prefix)
	if err != nil {
		return blockedCheck("tun.fakeip_route", "tun", "本机 TUN 回路", "Fake-IP 本机路由", "Fake-IP 网段无效。", "有效 IPv4 CIDR", prefix, err.Error())
	}
	if runtime.GOOS != "linux" {
		return warningCheck("tun.fakeip_route", "tun", "本机 TUN 回路", "Fake-IP 本机路由", "当前平台已验证 TUN 接口，但暂未执行统一的纯读取路由查询。", runtime.GOOS)
	}
	out, err := combinedOutputWithTimeout(ctx, 3*time.Second, "ip", "route", "get", ip.String())
	if err != nil {
		return blockedCheck("tun.fakeip_route", "tun", "本机 TUN 回路", "Fake-IP 本机路由", "内核无法计算 Fake-IP 的本机路由。", "命中 Mihomo TUN", "查询失败", err.Error())
	}
	text := strings.ToLower(string(out))
	if !strings.Contains(text, "dev mihomo") && !strings.Contains(text, "dev utun") {
		return blockedCheck("tun.fakeip_route", "tun", "本机 TUN 回路", "Fake-IP 本机路由", "Fake-IP 地址没有进入 Mihomo TUN。", "dev mihomo/utun", strings.TrimSpace(string(out)), "ip route get 只计算路由，未发送数据包")
	}
	return passedCheck("tun.fakeip_route", "tun", "本机 TUN 回路", "Fake-IP 本机路由", "本机 Fake-IP 路由会进入 Mihomo TUN。")
}

func (a *App) checkNetworkTransitionState() localLoopCheck {
	var active []string
	if fileExists(filepath.Join(a.DataDir, factoryResetMarkerName)) {
		active = append(active, "工厂重置")
	}
	if state := a.mosDNSRoutingState(); isTruthy(fmtAny(state["running"])) || strings.EqualFold(fmtAny(state["status"]), "running") {
		active = append(active, "MosDNS 路由规则生成")
	}
	if len(active) > 0 {
		return warningCheck("transition.active", "transition", "回路变更状态", "影响网络的过渡任务", "本机网络回路正在被修改，本轮结果只能作为过程状态。", strings.Join(active, ", "))
	}
	return passedCheck("transition.active", "transition", "回路变更状态", "影响网络的过渡任务", "当前没有正在改变本机网络回路的重置或规则生成任务。")
}
