export type SetupValidationIssue = {
  step: number;
  field: string;
  message: string;
};

export type SetupValidationValues = {
  username: string;
  password: string;
  confirmPassword: string;
  email: string;
  webPort: string;
  selected_interface: string;
  mosdnsEnabled: boolean;
  proxyCore: string;
  mosdnsInstallMode?: "upload" | "url";
  mosdnsBundleURL?: string;
  mosdnsBundleFile?: File | null;
};

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateSetupStep(step: number, form: SetupValidationValues): SetupValidationIssue[] {
  const issues: SetupValidationIssue[] = [];

  if (step === 0) {
    if (!form.username.trim()) issues.push({ step, field: "username", message: "请输入管理员用户名" });
    if (!form.password) issues.push({ step, field: "password", message: "请输入管理员密码" });
    if (!form.confirmPassword) {
      issues.push({ step, field: "confirmPassword", message: "请再次输入管理员密码" });
    } else if (form.password !== form.confirmPassword) {
      issues.push({ step, field: "confirmPassword", message: "两次输入的密码不一致" });
    }
    if (form.email.trim() && !validEmail(form.email.trim())) {
      issues.push({ step, field: "email", message: "请输入有效的邮箱地址，或将此项留空" });
    }
    const port = Number(form.webPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      issues.push({ step, field: "webPort", message: "Web 端口必须是 1-65535 之间的整数" });
    }
  }

  if (step === 1 && !form.selected_interface) {
    issues.push({ step, field: "selected_interface", message: "请选择用于运行服务的物理网卡" });
  }

  if (step === 2) {
    if (!form.mosdnsEnabled) issues.push({ step, field: "mosdnsEnabled", message: "MosDNS 是必装组件" });
    if (form.mosdnsInstallMode === "url") {
      if (!form.mosdnsBundleURL?.trim()) {
        issues.push({ step, field: "mosdnsBundle", message: "请输入 MosDNS ZIP 链接" });
      }
    } else if (!form.mosdnsBundleFile) {
      issues.push({ step, field: "mosdnsBundle", message: "请选择 MosDNS 本地 ZIP 文件" });
    }
    if (form.proxyCore === "none") issues.push({ step, field: "proxyCore", message: "请选择一个代理核心" });
  }

  return issues;
}

export function validateAllSetupSteps(form: SetupValidationValues) {
  return [0, 1, 2].flatMap((step) => validateSetupStep(step, form));
}
