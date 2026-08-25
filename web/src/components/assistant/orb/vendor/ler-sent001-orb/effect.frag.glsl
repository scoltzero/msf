#version 300 es

precision highp float;
precision highp int;

struct Uniforms {
    vec2 size;
    float time;
    float speed;
    float radius;
    float zoom;
    float warp;
    float ridgeAmt;
    float sharp;
    float shade;
    float sheen;
    float gloss;
    float shellMidAlpha;
    float shellEdgeAlpha;
    float exposure;
    float style;
    float edgeSoftness;
    float edgeGlow;
    float paletteCount;
    float glassEnabled;
    float glassOpacity;
    float contourDeform;
    float bandDensity;
    float chromaticShift;
    float metalScale;
    float metalStretch;
    float metalAngle;
    float metalOffset;
    float metalPhase;
    float metalEvolution;
    float metalRoughness;
    float metalDepth;
    vec4 colorA;
    vec4 colorB;
    vec4 colorC;
    vec4 colorD;
    vec4 highlightColor;
    vec4 shellInner;
    vec4 shellMid;
    vec4 shellEdge;
    vec4 sheenColor;
    vec4 specColor;
    vec4 canvasColor;
    vec4 glowColor;
    vec4 paletteStop0_;
    vec4 paletteStop1_;
    vec4 paletteStop2_;
    vec4 paletteStop3_;
    vec4 paletteStop4_;
    vec4 paletteStop5_;
    vec4 paletteStop6_;
    vec4 paletteStop7_;
    vec4 paletteStop8_;
    vec4 paletteStop9_;
    vec4 paletteStop10_;
    vec4 paletteStop11_;
};
struct MfRamp {
    float n;
    vec3 s0_;
    vec3 s1_;
    vec3 s2_;
    vec3 s3_;
    vec3 s4_;
    vec3 s5_;
    vec3 s6_;
    vec3 s7_;
    vec3 s8_;
    vec3 s9_;
    vec3 s10_;
    vec3 s11_;
};
struct VOut {
    vec4 pos;
    vec2 uv;
};
const float GL_FU = 0.8817204;
const float GL_BSIG_CLEAR = 0.018;
const float GL_BSIG_GLASS = 0.0399;
const float GL_KA = 6.0;
const float GL_KG = 4.1209;
const float GL_KWA = 0.5;
const float GL_KR = 0.32;
const float GL_GH = 1.7320508;
const float GL_CLEAR_EA = 0.995;
const float GL_CLEAR_EB = 1.04;

layout(std140) uniform Uniforms_block_0Fragment { Uniforms _group_0_binding_0_fs; };

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

float mfEdgeD(float soft) {
    return (soft - 0.005);
}
vec3 mfEdgeGlow(vec3 col, vec2 uv, vec2 ctr, float rad, float soft_1, float glow, vec3 glowRGB) {
    if ((glow <= 0.0)) {
        return col;
    }
    float r_3 = length((uv - ctr));
    float outside = smoothstep((rad - max(soft_1, 0.0005)), (rad + max(soft_1, 0.0005)), r_3);
    return (col + (glowRGB * ((glow * exp((-(max((r_3 - rad), 0.0)) * 11.0))) * outside)));
}

vec3 mfRampPick(float idx, vec3 s0_, vec3 s1_, vec3 s2_, vec3 s3_, vec3 s4_, vec3 s5_, vec3 s6_, vec3 s7_, vec3 s8_, vec3 s9_, vec3 s10_, vec3 s11_) {
    vec3 r = vec3(0.0);
    r = s0_;
    vec3 _e14 = r;
    r = ((idx == 1.0) ? s1_ : _e14);
    vec3 _e18 = r;
    r = ((idx == 2.0) ? s2_ : _e18);
    vec3 _e22 = r;
    r = ((idx == 3.0) ? s3_ : _e22);
    vec3 _e26 = r;
    r = ((idx == 4.0) ? s4_ : _e26);
    vec3 _e30 = r;
    r = ((idx == 5.0) ? s5_ : _e30);
    vec3 _e34 = r;
    r = ((idx == 6.0) ? s6_ : _e34);
    vec3 _e38 = r;
    r = ((idx == 7.0) ? s7_ : _e38);
    vec3 _e42 = r;
    r = ((idx == 8.0) ? s8_ : _e42);
    vec3 _e46 = r;
    r = ((idx == 9.0) ? s9_ : _e46);
    vec3 _e50 = r;
    r = ((idx == 10.0) ? s10_ : _e50);
    vec3 _e54 = r;
    r = ((idx == 11.0) ? s11_ : _e54);
    vec3 _e58 = r;
    return _e58;
}

vec3 mfRampCyc(float tIn, float n, vec3 s0_1, vec3 s1_1, vec3 s2_1, vec3 s3_1, vec3 s4_1, vec3 s5_1, vec3 s6_1, vec3 s7_1, vec3 s8_1, vec3 s9_1, vec3 s10_1, vec3 s11_1) {
    float k_3 = clamp(floor((n + 0.5)), 1.0, 12.0);
    float x = (fract(tIn) * k_3);
    float i0_ = min(floor(x), (k_3 - 1.0));
    float i1_ = (((i0_ + 1.0) >= k_3) ? 0.0 : (i0_ + 1.0));
    vec3 _e33 = mfRampPick(i0_, s0_1, s1_1, s2_1, s3_1, s4_1, s5_1, s6_1, s7_1, s8_1, s9_1, s10_1, s11_1);
    vec3 _e34 = mfRampPick(i1_, s0_1, s1_1, s2_1, s3_1, s4_1, s5_1, s6_1, s7_1, s8_1, s9_1, s10_1, s11_1);
    return mix(_e33, _e34, (x - i0_));
}

vec3 mfRampLin(float tIn_1, float n_1, vec3 s0_2, vec3 s1_2, vec3 s2_2, vec3 s3_2, vec3 s4_2, vec3 s5_2, vec3 s6_2, vec3 s7_2, vec3 s8_2, vec3 s9_2, vec3 s10_2, vec3 s11_2) {
    float k_4 = clamp(floor((n_1 + 0.5)), 1.0, 12.0);
    float x_1 = (clamp(tIn_1, 0.0, 1.0) * (k_4 - 1.0));
    float i0_1 = clamp(floor(x_1), 0.0, max((k_4 - 2.0), 0.0));
    vec3 _e33 = mfRampPick(i0_1, s0_2, s1_2, s2_2, s3_2, s4_2, s5_2, s6_2, s7_2, s8_2, s9_2, s10_2, s11_2);
    vec3 _e36 = mfRampPick((i0_1 + 1.0), s0_2, s1_2, s2_2, s3_2, s4_2, s5_2, s6_2, s7_2, s8_2, s9_2, s10_2, s11_2);
    return mix(_e33, _e36, (x_1 - i0_1));
}

MfRamp mfRampOf(float n_2, vec3 s0_3, vec3 s1_3, vec3 s2_3, vec3 s3_3, vec3 s4_3, vec3 s5_3, vec3 s6_3, vec3 s7_3, vec3 s8_3, vec3 s9_3, vec3 s10_3, vec3 s11_3) {
    return MfRamp(n_2, s0_3, s1_3, s2_3, s3_3, s4_3, s5_3, s6_3, s7_3, s8_3, s9_3, s10_3, s11_3);
}

vec3 mfRampCycR(float t, MfRamp r_1) {
    vec3 _e15 = mfRampCyc(t, r_1.n, r_1.s0_, r_1.s1_, r_1.s2_, r_1.s3_, r_1.s4_, r_1.s5_, r_1.s6_, r_1.s7_, r_1.s8_, r_1.s9_, r_1.s10_, r_1.s11_);
    return _e15;
}

vec3 mfRampLinR(float t_1, MfRamp r_2) {
    vec3 _e15 = mfRampLin(t_1, r_2.n, r_2.s0_, r_2.s1_, r_2.s2_, r_2.s3_, r_2.s4_, r_2.s5_, r_2.s6_, r_2.s7_, r_2.s8_, r_2.s9_, r_2.s10_, r_2.s11_);
    return _e15;
}

float lqHash(vec2 pIn) {
    vec2 p_1 = vec2(0.0);
    p_1 = fract((pIn * vec2(123.34, 456.21)));
    vec2 _e7 = p_1;
    vec2 _e8 = p_1;
    vec2 _e9 = p_1;
    p_1 = (_e7 + vec2(dot(_e8, (_e9 + vec2(45.32)))));
    float _e17 = p_1.x;
    float _e19 = p_1.y;
    return fract((_e17 * _e19));
}

float lqNoise(vec2 p_2) {
    vec2 f = vec2(0.0);
    vec2 i_4 = floor(p_2);
    f = fract(p_2);
    vec2 _e4 = f;
    vec2 _e5 = f;
    vec2 _e7 = f;
    f = ((_e4 * _e5) * (vec2(3.0) - (2.0 * _e7)));
    float _e14 = lqHash(i_4);
    float _e19 = lqHash((i_4 + vec2(1.0, 0.0)));
    float _e21 = f.x;
    float _e27 = lqHash((i_4 + vec2(0.0, 1.0)));
    float _e32 = lqHash((i_4 + vec2(1.0, 1.0)));
    float _e34 = f.x;
    float _e37 = f.y;
    return mix(mix(_e14, _e19, _e21), mix(_e27, _e32, _e34), _e37);
}

vec2 lqFbm(vec2 pIn_1, float bs) {
    vec2 p_3 = vec2(0.0);
    float s = 0.0;
    float a = 0.5;
    float m = 0.0;
    float vr = 0.0;
    float g = 1.0;
    int i_1 = 0;
    p_3 = pIn_1;
    float e = ((-6.0 * bs) * bs);
    bool loop_init = true;
    while(true) {
        if (!loop_init) {
            int _e74 = i_1;
            i_1 = (_e74 + 1);
        }
        loop_init = false;
        int _e18 = i_1;
        if ((_e18 < 5)) {
        } else {
            break;
        }
        {
            float _e21 = g;
            float b_1 = exp((e * _e21));
            float _e24 = s;
            float _e25 = a;
            vec2 _e26 = p_3;
            float _e27 = lqNoise(_e26);
            s = (_e24 + (_e25 * (0.5 + (b_1 * (_e27 - 0.5)))));
            float _e35 = vr;
            float _e36 = a;
            float _e37 = a;
            vr = (_e35 + ((_e36 * _e37) * (1.0 - (b_1 * b_1))));
            float _e44 = m;
            float _e45 = a;
            m = (_e44 + _e45);
            float _e47 = a;
            a = (_e47 * 0.5);
            float _e50 = g;
            g = (_e50 * GL_KG);
            float _e54 = p_3.x;
            float _e58 = p_3.y;
            float _e63 = p_3.x;
            float _e67 = p_3.y;
            p_3 = (vec2(((0.8 * _e54) - (0.6 * _e58)), ((0.6 * _e63) + (0.8 * _e67))) * 2.03);
        }
    }
    float _e77 = s;
    float _e78 = m;
    float _e81 = vr;
    float _e84 = m;
    return vec2((_e77 / _e78), ((GL_KR * sqrt(_e81)) / _e84));
}

float lqRidge(float v, float k) {
    return pow(clamp((1.0 - abs(((v * 2.0) - 1.0))), 0.0, 1.0), k);
}

vec3 lqRamp(float v_1, vec3 cA, vec3 cB, vec3 cC, vec3 cD) {
    vec3 c = vec3(0.0);
    c = mix(cA, cB, smoothstep(0.0, 0.45, v_1));
    vec3 _e10 = c;
    c = mix(_e10, cC, smoothstep(0.38, 0.72, v_1));
    vec3 _e15 = c;
    c = mix(_e15, cD, smoothstep(0.68, 1.0, v_1));
    vec3 _e20 = c;
    float _e23 = _group_0_binding_0_fs.paletteCount;
    vec4 _e26 = _group_0_binding_0_fs.paletteStop0_;
    vec4 _e30 = _group_0_binding_0_fs.paletteStop1_;
    vec4 _e34 = _group_0_binding_0_fs.paletteStop2_;
    vec4 _e38 = _group_0_binding_0_fs.paletteStop3_;
    vec4 _e42 = _group_0_binding_0_fs.paletteStop4_;
    vec4 _e46 = _group_0_binding_0_fs.paletteStop5_;
    vec4 _e50 = _group_0_binding_0_fs.paletteStop6_;
    vec4 _e54 = _group_0_binding_0_fs.paletteStop7_;
    vec4 _e58 = _group_0_binding_0_fs.paletteStop8_;
    vec4 _e62 = _group_0_binding_0_fs.paletteStop9_;
    vec4 _e66 = _group_0_binding_0_fs.paletteStop10_;
    vec4 _e70 = _group_0_binding_0_fs.paletteStop11_;
    vec3 _e72 = mfRampLin(v_1, _e23, _e26.xyz, _e30.xyz, _e34.xyz, _e38.xyz, _e42.xyz, _e46.xyz, _e50.xyz, _e54.xyz, _e58.xyz, _e62.xyz, _e66.xyz, _e70.xyz);
    float _e75 = _group_0_binding_0_fs.paletteCount;
    return ((_e75 > 0.5) ? _e72 : _e20);
}

float lqRidgeS(vec2 vs, float k_1) {
    float d_1 = (GL_GH * vs.y);
    float _e7 = lqRidge((vs.x - d_1), k_1);
    float _e9 = lqRidge(vs.x, k_1);
    float _e15 = lqRidge((vs.x + d_1), k_1);
    return (((_e7 + (4.0 * _e9)) + _e15) / 6.0);
}

float lqStepS(vec2 vs_1, float a_1, float b) {
    float d_2 = (GL_GH * vs_1.y);
    return (((smoothstep(a_1, b, (vs_1.x - d_2)) + (4.0 * smoothstep(a_1, b, vs_1.x))) + smoothstep(a_1, b, (vs_1.x + d_2))) / 6.0);
}

float lqPowS(vec2 vs_2, float k_2) {
    float d_3 = (GL_GH * vs_2.y);
    return (((pow(clamp((vs_2.x - d_3), 0.0, 1.0), k_2) + (4.0 * pow(clamp(vs_2.x, 0.0, 1.0), k_2))) + pow(clamp((vs_2.x + d_3), 0.0, 1.0), k_2)) / 6.0);
}

vec3 glsFinishPresetFluid(vec3 colorIn, vec2 p_4) {
    vec3 color = vec3(0.0);
    color = colorIn;
    vec3 _e3 = color;
    vec4 _e6 = _group_0_binding_0_fs.highlightColor;
    float _e10 = _group_0_binding_0_fs.shade;
    color = mix(_e3, _e6.xyz, ((_e10 * 0.22) * smoothstep(0.15, 1.15, dot(p_4, vec2(-0.32, 0.78)))));
    vec3 _e22 = color;
    float _e25 = _group_0_binding_0_fs.shade;
    color = (_e22 * (1.0 - ((_e25 * 0.34) * smoothstep(-0.1, 1.2, dot(p_4, vec2(0.45, -0.62))))));
    vec3 _e39 = color;
    float _e42 = _group_0_binding_0_fs.shade;
    color = (_e39 * (1.0 - ((_e42 * 0.22) * smoothstep(0.72, 1.08, length(p_4)))));
    vec3 _e53 = color;
    return clamp(_e53, vec3(0.0), vec3(1.0));
}

vec2 glsSiriBand(vec2 q, float drift, float phaseOffset, float amplitude, float mainY, float envelope, float softness) {
    float y = ((amplitude * envelope) * sin((((q.x * 1.0) + drift) + phaseOffset)));
    float distanceToLine = abs((q.y - y));
    float line = (0.018 / (sqrt(((distanceToLine * distanceToLine) + (softness * softness))) + 0.026));
    float bandDistance = max(0.0, max((q.y - max(mainY, y)), (min(mainY, y) - q.y)));
    float band = (0.018 / (bandDistance + 0.075));
    return vec2(line, band);
}

vec3 glsSiriFluid(vec2 p_5, float t_2) {
    vec3 color_1 = vec3(0.0);
    float _e4 = _group_0_binding_0_fs.zoom;
    float scale_1 = (0.74 + (_e4 * 0.34));
    vec2 q_7 = (p_5 / vec2(scale_1));
    float xNorm = q_7.x;
    float envelopeBase = cos((1.5707964 * min(abs((0.9 * xNorm)), 1.0)));
    float envelope_1 = (envelopeBase * envelopeBase);
    float low = (0.5 + (0.5 * cos((t_2 * 0.37))));
    float mid = (0.5 + (0.5 * sin(((t_2 * 0.51) + 1.2))));
    float high = (0.5 + (0.5 * cos(((t_2 * 0.73) + 2.1))));
    float drift_1 = (t_2 * 2.4);
    float _e50 = _group_0_binding_0_fs.ridgeAmt;
    float mainAmplitude = ((0.25 + (_e50 * 0.075)) + (low * 0.018));
    float bandAmplitude = ((mainAmplitude + (mid * 0.025)) + (high * 0.018));
    float mainY_1 = ((mainAmplitude * envelope_1) * sin(((q_7.x * 1.1) + drift_1)));
    float _e73 = _group_0_binding_0_fs.warp;
    float separation = ((1.85 + (_e73 * 0.2)) + (mid * 0.28));
    float _e83 = _group_0_binding_0_fs.ridgeAmt;
    float softness_2 = ((0.035 + ((1.0 - _e83) * 0.018)) + (mid * 0.006));
    vec2 _e94 = glsSiriBand(q_7, drift_1, -(separation), bandAmplitude, mainY_1, envelope_1, softness_2);
    vec2 _e98 = glsSiriBand(q_7, drift_1, (-(separation) * 0.34), bandAmplitude, mainY_1, envelope_1, softness_2);
    vec2 _e101 = glsSiriBand(q_7, drift_1, (separation * 0.34), bandAmplitude, mainY_1, envelope_1, softness_2);
    vec2 _e102 = glsSiriBand(q_7, drift_1, separation, bandAmplitude, mainY_1, envelope_1, softness_2);
    float w0_ = (_e94.x + _e94.y);
    float w1_ = (_e98.x + _e98.y);
    float w2_ = (_e101.x + _e101.y);
    float w3_ = (_e102.x + _e102.y);
    float total = (((w0_ + w1_) + w2_) + w3_);
    float dominant0_ = (w0_ * w0_);
    float dominant1_ = (w1_ * w1_);
    float dominant2_ = (w2_ * w2_);
    float dominant3_ = (w3_ * w3_);
    float dominantTotal = (((dominant0_ + dominant1_) + dominant2_) + dominant3_);
    vec4 _e127 = _group_0_binding_0_fs.colorA;
    vec4 _e132 = _group_0_binding_0_fs.colorC;
    vec4 _e138 = _group_0_binding_0_fs.colorB;
    vec4 _e144 = _group_0_binding_0_fs.colorD;
    vec3 spectral = (((((_e127.xyz * dominant0_) + (_e132.xyz * dominant1_)) + (_e138.xyz * dominant2_)) + (_e144.xyz * dominant3_)) / vec3(max(dominantTotal, 0.0001)));
    float energy = ((1.0 - exp((-(total) * 0.58))) * envelope_1);
    float mainDistance = abs((q_7.y - mainY_1));
    float whiteCore = (exp(((-(mainDistance) * mainDistance) / 0.0028)) * envelope_1);
    vec4 _e170 = _group_0_binding_0_fs.colorD;
    vec4 _e174 = _group_0_binding_0_fs.colorB;
    vec3 atmosphere = (mix(_e170.xyz, _e174.xyz, smoothstep(-0.7, 0.7, q_7.y)) * 0.018);
    color_1 = (atmosphere + ((spectral * energy) * 1.14));
    vec3 _e188 = color_1;
    vec4 _e191 = _group_0_binding_0_fs.highlightColor;
    color_1 = (_e188 + ((_e191.xyz * whiteCore) * (0.18 + (0.1 * low))));
    vec3 _e200 = color_1;
    vec3 _e203 = color_1;
    color_1 = (_e200 / (vec3(1.0) + (_e203 * 0.18)));
    vec3 _e208 = color_1;
    vec3 _e209 = glsFinishPresetFluid(_e208, p_5);
    return _e209;
}

float glsSpectrumHeight(vec2 q_1, float t_3, float frequency, float phaseOffset_1, float amplitude_1) {
    float x_2 = (q_1.x * 2.15);
    float envelope_2 = pow((4.0 / (4.0 + (x_2 * x_2))), 4.0);
    float breathing = (0.82 + (0.18 * sin(((t_3 * 0.48) + (phaseOffset_1 * 0.7)))));
    float wave = abs(sin((((frequency * x_2) - (t_3 * 1.36)) + phaseOffset_1)));
    return (((envelope_2 * amplitude_1) * breathing) * (0.28 + (0.72 * wave)));
}

float glsSpectrumLayer(vec2 q_2, float height, float softness_1) {
    return ((1.0 - smoothstep(max((height - softness_1), 0.0), (height + softness_1), abs(q_2.y))) * smoothstep(0.0, 0.045, height));
}

vec3 glsSpectrumFluid(vec2 p_6, float t_4) {
    vec3 color_2 = vec3(0.0);
    float _e4 = _group_0_binding_0_fs.zoom;
    float scale_2 = (0.74 + (_e4 * 0.34));
    vec2 q_8 = (p_6 / vec2(scale_2));
    float _e13 = _group_0_binding_0_fs.ridgeAmt;
    float amplitude_2 = (0.26 + (_e13 * 0.27));
    float _e20 = _group_0_binding_0_fs.warp;
    float frequency_1 = (0.72 + (_e20 * 0.095));
    float _e27 = _group_0_binding_0_fs.ridgeAmt;
    float softness_3 = (0.026 + ((1.0 - _e27) * 0.032));
    float _e39 = glsSpectrumHeight(q_8, t_4, (frequency_1 * 0.82), -1.2, (amplitude_2 * 0.72));
    float _e41 = glsSpectrumHeight(q_8, t_4, frequency_1, 0.45, amplitude_2);
    float _e47 = glsSpectrumHeight(q_8, t_4, (frequency_1 * 1.17), 2.05, (amplitude_2 * 0.82));
    float _e48 = glsSpectrumLayer(q_8, _e39, softness_3);
    float _e49 = glsSpectrumLayer(q_8, _e41, softness_3);
    float _e50 = glsSpectrumLayer(q_8, _e47, softness_3);
    float spectrumX = (q_8.x * 2.15);
    float envelope_3 = pow((4.0 / (4.0 + (spectrumX * spectrumX))), 4.0);
    float support = (exp(((-(q_8.y) * q_8.y) / 0.00072)) * envelope_3);
    float total_1 = ((_e48 + _e49) + _e50);
    vec4 _e73 = _group_0_binding_0_fs.colorB;
    vec4 _e78 = _group_0_binding_0_fs.colorC;
    vec4 _e84 = _group_0_binding_0_fs.colorD;
    vec3 spectral_1 = ((((_e73.xyz * _e48) + (_e78.xyz * _e49)) + (_e84.xyz * _e50)) / vec3(max(total_1, 0.001)));
    vec4 _e94 = _group_0_binding_0_fs.colorD;
    color_2 = ((_e94.xyz * 0.025) + (spectral_1 * (1.0 - exp((-(total_1) * 0.86)))));
    vec3 _e107 = color_2;
    vec4 _e110 = _group_0_binding_0_fs.colorA;
    color_2 = (_e107 + ((_e110.xyz * support) * 0.58));
    vec3 _e116 = color_2;
    vec3 _e119 = color_2;
    color_2 = (_e116 / (vec3(1.0) + (_e119 * 0.2)));
    vec3 _e124 = color_2;
    vec3 _e125 = glsFinishPresetFluid(_e124, p_6);
    return _e125;
}

float glsAuroraLayer(vec2 p_7, float t_5, float offset) {
    float drift_2 = ((t_5 * 0.18) + (offset * 2.5));
    float _e11 = _group_0_binding_0_fs.warp;
    float wave1_ = (sin((((p_7.x * (2.0 + (_e11 * 0.13))) + drift_2) + (offset * 6.0))) * 0.25);
    float wave2_ = (sin((((p_7.x * 3.7) + (drift_2 * 1.3)) + (offset * 4.0))) * 0.12);
    float wave3_ = (sin((((p_7.x * 7.2) + (drift_2 * 0.7)) + (offset * 8.0))) * 0.055);
    vec2 _e62 = lqFbm(vec2(((p_7.x * 1.6) + (drift_2 * 0.35)), ((p_7.y * 0.8) + (offset * 3.0))), 0.018);
    float noiseValue = _e62.x;
    float center = (((((offset * 0.46) + wave1_) + wave2_) + wave3_) + ((noiseValue - 0.5) * 0.28));
    float dist = abs((p_7.y - center));
    float _e81 = _group_0_binding_0_fs.ridgeAmt;
    float glow_1 = exp(((-(dist) * dist) * (13.0 - (5.0 * _e81))));
    vec2 _e102 = lqFbm(vec2(((p_7.x * 4.0) + (t_5 * 0.22)), ((p_7.y * 7.0) + (offset * 5.0))), 0.012);
    float shimmer = _e102.x;
    return (glow_1 * (0.64 + (0.36 * shimmer)));
}

vec3 glsAuroraFluid(vec2 p_8, float t_6) {
    vec3 color_3 = vec3(0.0);
    float _e4 = _group_0_binding_0_fs.zoom;
    vec2 q_9 = (p_8 * (0.82 + (_e4 * 0.58)));
    float _e11 = glsAuroraLayer(q_9, t_6, -0.72);
    float _e13 = glsAuroraLayer(q_9, t_6, 0.0);
    float _e15 = glsAuroraLayer(q_9, t_6, 0.72);
    vec4 _e18 = _group_0_binding_0_fs.colorA;
    color_3 = (_e18.xyz * (0.46 + (0.18 * (q_9.y + 1.0))));
    vec3 _e29 = color_3;
    vec4 _e32 = _group_0_binding_0_fs.colorB;
    color_3 = (_e29 + ((_e32.xyz * _e11) * 1.3));
    vec3 _e38 = color_3;
    vec4 _e41 = _group_0_binding_0_fs.colorC;
    color_3 = (_e38 + ((_e41.xyz * _e13) * 1.15));
    vec3 _e47 = color_3;
    vec4 _e50 = _group_0_binding_0_fs.colorD;
    color_3 = (_e47 + ((_e50.xyz * _e15) * 1.2));
    vec3 _e56 = color_3;
    vec4 _e59 = _group_0_binding_0_fs.colorB;
    vec4 _e63 = _group_0_binding_0_fs.colorD;
    color_3 = (_e56 + ((mix(_e59.xyz, _e63.xyz, 0.5) * min((_e11 * _e15), _e13)) * 0.65));
    vec2 starUv = ((q_9 + vec2(1.0)) * 18.0);
    vec2 starCell = floor(starUv);
    float _e79 = lqHash(starCell);
    float starPoint = exp((-(dot((fract(starUv) - vec2(0.5)), (fract(starUv) - vec2(0.5)))) * 90.0));
    float stars = ((step(0.965, _e79) * starPoint) * (0.55 + (0.45 * sin(((t_6 * (1.0 + (_e79 * 2.0))) + (_e79 * 6.28))))));
    vec3 _e110 = color_3;
    vec4 _e113 = _group_0_binding_0_fs.highlightColor;
    color_3 = (_e110 + ((_e113.xyz * stars) * (1.0 - clamp(((_e11 + _e13) + _e15), 0.0, 1.0))));
    vec3 _e125 = color_3;
    vec3 _e128 = color_3;
    color_3 = (_e125 / (vec3(1.0) + (_e128 * 0.28)));
    vec3 _e133 = color_3;
    vec3 _e134 = glsFinishPresetFluid(_e133, p_8);
    return _e134;
}

vec2 glsRotate(vec2 p_9, float angle) {
    float c_1 = cos(angle);
    float s_1 = sin(angle);
    return vec2(((c_1 * p_9.x) - (s_1 * p_9.y)), ((s_1 * p_9.x) + (c_1 * p_9.y)));
}

float glsNeuroShape(vec2 pIn_2, float t_7) {
    vec2 p_10 = vec2(0.0);
    vec2 sineAccum = vec2(0.0);
    vec2 result = vec2(0.0);
    float scale = 8.0;
    int j = 0;
    float _e4 = _group_0_binding_0_fs.zoom;
    p_10 = (pIn_2 * (0.34 + (0.08 * _e4)));
    bool loop_init_1 = true;
    while(true) {
        if (!loop_init_1) {
            int _e60 = j;
            j = (_e60 + 1);
        }
        loop_init_1 = false;
        int _e21 = j;
        if ((_e21 < 11)) {
        } else {
            break;
        }
        {
            vec2 _e24 = p_10;
            vec2 _e26 = glsRotate(_e24, 1.0);
            p_10 = _e26;
            vec2 _e27 = sineAccum;
            vec2 _e29 = glsRotate(_e27, 1.0);
            sineAccum = _e29;
            vec2 _e30 = p_10;
            float _e31 = scale;
            int _e33 = j;
            vec2 _e37 = sineAccum;
            vec2 layer = ((((_e30 * _e31) + vec2(float(_e33))) + _e37) - vec2((t_7 * 0.34)));
            vec2 _e43 = sineAccum;
            sineAccum = (_e43 + sin(layer));
            vec2 _e46 = result;
            float _e53 = scale;
            result = (_e46 + ((vec2(0.5) + (0.5 * cos(layer))) / vec2(_e53)));
            float _e57 = scale;
            scale = (_e57 * 1.16);
        }
    }
    float _e64 = result.x;
    float _e66 = result.y;
    return (_e64 + _e66);
}

vec3 glsPlasmaFluid(vec2 p_11, float t_8) {
    vec3 color_4 = vec3(0.0);
    float _e2 = glsNeuroShape(p_11, t_8);
    float _e5 = _group_0_binding_0_fs.warp;
    float phase_1 = ((((_e2 * (10.0 + _e5)) + (p_11.x * 1.7)) - (p_11.y * 1.3)) - (t_8 * 0.52));
    float _e22 = _group_0_binding_0_fs.ridgeAmt;
    float ridgeWidth = (0.62 - (0.24 * _e22));
    float _e31 = _group_0_binding_0_fs.sharp;
    float primary = pow(abs(cos(phase_1)), max(1.3, (_e31 * ridgeWidth)));
    float _e51 = _group_0_binding_0_fs.sharp;
    float secondary = pow(abs(cos((((phase_1 * 0.53) + (atan(p_11.y, p_11.x) * 2.0)) + (t_8 * 0.21)))), max(1.6, (_e51 * (ridgeWidth + 0.1))));
    float filaments = max(primary, (secondary * 0.64));
    float core = pow(primary, 4.0);
    float polarity = (0.5 + (0.5 * sin(((phase_1 * 0.37) + (_e2 * 3.0)))));
    vec4 _e75 = _group_0_binding_0_fs.colorA;
    vec4 _e81 = _group_0_binding_0_fs.colorD;
    color_4 = mix((_e75.xyz * 0.42), (_e81.xyz * 0.48), (polarity * 0.46));
    vec3 _e89 = color_4;
    vec4 _e92 = _group_0_binding_0_fs.colorB;
    color_4 = mix(_e89, _e92.xyz, (filaments * 0.72));
    vec3 _e97 = color_4;
    vec4 _e100 = _group_0_binding_0_fs.colorC;
    color_4 = mix(_e97, _e100.xyz, (core * 0.68));
    vec3 _e105 = color_4;
    vec4 _e108 = _group_0_binding_0_fs.highlightColor;
    color_4 = (_e105 + ((_e108.xyz * pow(core, 3.0)) * 0.16));
    vec3 _e116 = color_4;
    vec3 _e119 = color_4;
    color_4 = (_e116 / (vec3(1.0) + (_e119 * 0.34)));
    vec3 _e124 = color_4;
    vec3 _e125 = glsFinishPresetFluid(_e124, p_11);
    return _e125;
}

vec3 glsChromeFluid(vec2 p_12, float t_9) {
    vec2 q_3 = vec2(0.0);
    int i_2 = 1;
    vec3 color_5 = vec3(0.0);
    float _e4 = _group_0_binding_0_fs.zoom;
    q_3 = (p_12 * (1.0 + (_e4 * 0.35)));
    float _e13 = _group_0_binding_0_fs.warp;
    float amplitude_3 = (0.028 * _e13);
    bool loop_init_2 = true;
    while(true) {
        if (!loop_init_2) {
            int _e53 = i_2;
            i_2 = (_e53 + 1);
        }
        loop_init_2 = false;
        int _e18 = i_2;
        if ((_e18 <= 9)) {
        } else {
            break;
        }
        {
            int _e21 = i_2;
            float fi = float(_e21);
            float _e25 = q_3.x;
            float _e30 = q_3.y;
            q_3.x = (_e25 + ((amplitude_3 / fi) * cos((((fi * 2.7) * _e30) + (t_9 * 0.46)))));
            float _e40 = q_3.y;
            float _e45 = q_3.x;
            q_3.y = (_e40 + ((amplitude_3 / fi) * cos((((fi * 3.1) * _e45) - (t_9 * 0.4)))));
        }
    }
    float _e59 = q_3.y;
    float _e62 = q_3.x;
    float denominator = max(abs(sin((((t_9 * 0.24) - _e59) - _e62))), 0.045);
    float flare = clamp((1.0 / denominator), 0.0, 18.0);
    float metal = smoothstep(1.15, 7.5, flare);
    float _e77 = q_3.x;
    float _e79 = q_3.y;
    float _e83 = _group_0_binding_0_fs.sharp;
    float fold = (0.5 + (0.5 * cos((((_e77 - _e79) * (3.2 + (_e83 * 0.28))) + (t_9 * 0.32)))));
    float value = clamp(((metal * 0.74) + (fold * 0.36)), 0.0, 1.0);
    vec4 _e107 = _group_0_binding_0_fs.colorD;
    vec4 _e111 = _group_0_binding_0_fs.colorC;
    vec4 _e115 = _group_0_binding_0_fs.colorB;
    vec4 _e119 = _group_0_binding_0_fs.colorA;
    vec3 _e121 = lqRamp(value, _e107.xyz, _e111.xyz, _e115.xyz, _e119.xyz);
    color_5 = _e121;
    vec3 _e123 = color_5;
    vec4 _e126 = _group_0_binding_0_fs.colorA;
    color_5 = mix(_e123, _e126.xyz, (pow(metal, 5.0) * 0.62));
    vec3 _e133 = color_5;
    vec3 _e134 = glsFinishPresetFluid(_e133, p_12);
    return _e134;
}

float glsChromaticMetalPhase(vec2 p_13, float t_10) {
    vec2 q_4 = vec2(0.0);
    float _e4 = _group_0_binding_0_fs.metalAngle;
    float angle_2 = (_e4 * 0.017453292);
    float _e9 = _group_0_binding_0_fs.metalScale;
    float scale_3 = max(_e9, 0.05);
    float _e14 = _group_0_binding_0_fs.metalStretch;
    float stretch = mix(0.48, 1.58, clamp(_e14, 0.0, 1.0));
    vec2 _e23 = glsRotate((p_13 / vec2(scale_3)), angle_2);
    q_4 = _e23;
    float _e26 = q_4.x;
    float _e29 = q_4.y;
    q_4 = vec2((_e26 / stretch), (_e29 * stretch));
    float _e36 = _group_0_binding_0_fs.metalPhase;
    float cycle = ((t_10 * 0.46) + (_e36 * 6.2831855));
    float _e42 = _group_0_binding_0_fs.metalEvolution;
    float evolution = clamp(_e42, 0.0, 2.0);
    float _e48 = q_4.x;
    float _e50 = q_4.y;
    q_4.x = (_e48 + ((sin(((_e50 * 1.86) - cycle)) * 0.095) * evolution));
    float _e61 = q_4.x;
    float _e63 = q_4.x;
    float _e65 = q_4.y;
    q_4.x = (_e61 + ((sin(((((_e63 + _e65) * 1.28) + (cycle * 2.0)) + 1.4)) * 0.045) * evolution));
    float _e81 = q_4.y;
    float _e83 = q_4.x;
    q_4.y = (_e81 + ((sin((((_e83 * 1.52) + cycle) + 0.8)) * 0.07) * evolution));
    float _e96 = _group_0_binding_0_fs.bandDensity;
    float repeats = max(_e96, 1.0);
    float _e100 = q_4.x;
    float _e105 = q_4.y;
    float _e118 = q_4.x;
    float _e120 = q_4.y;
    float _e135 = q_4.x;
    float _e139 = q_4.y;
    float _e168 = _group_0_binding_0_fs.metalOffset;
    return (((((((((_e100 * repeats) * 2.18) + ((sin(((_e105 * (1.3 + (repeats * 0.26))) - cycle)) * 0.56) * evolution)) + ((sin(((((_e118 - _e120) * 1.34) + (cycle * 2.0)) + 1.7)) * 0.27) * evolution)) + ((sin((((((_e135 * 0.72) + _e139) * 2.1) - (cycle * 3.0)) + 0.35)) * 0.11) * evolution)) + (sin(cycle) * 0.1)) + (sin(((cycle * 3.0) + 0.7)) * 0.035)) + cycle) + (_e168 * 6.2831855));
}

float glsChromaticMetalTone(float phase) {
    float wave_1 = (0.5 + (0.5 * cos(phase)));
    float _e8 = _group_0_binding_0_fs.metalRoughness;
    float roughness = clamp(_e8, 0.0, 1.0);
    float _e14 = _group_0_binding_0_fs.metalDepth;
    float depth = clamp(_e14, 0.0, 1.0);
    float edge = (0.025 + (roughness * 0.18));
    float broadReflection = smoothstep((0.5 - edge), (0.5 + edge), wave_1);
    float hardReflection = pow(wave_1, mix(13.0, 4.0, roughness));
    float blackFold = pow((1.0 - wave_1), mix(9.0, 3.0, roughness));
    float body = mix(wave_1, broadReflection, (0.2 + (depth * 0.3)));
    return clamp((((0.018 + (body * (0.46 + (depth * 0.12)))) + (hardReflection * (0.3 + (depth * 0.42)))) - (blackFold * (0.07 + (depth * 0.11)))), 0.0, 1.0);
}

vec3 glsChromaticMetalSample(vec2 p_14, float t_11) {
    float _e2 = glsChromaticMetalPhase(p_14, t_11);
    float _e5 = _group_0_binding_0_fs.metalAngle;
    float angle_3 = (_e5 * 0.017453292);
    float _e10 = _group_0_binding_0_fs.metalScale;
    vec2 _e15 = glsRotate((p_14 / vec2(max(_e10, 0.05))), angle_3);
    float brushed = (sin(((_e15.y * 146.0) + (sin((_e15.x * 11.0)) * 0.58))) + (0.48 * sin(((_e15.y * 317.0) - (_e15.x * 5.0)))));
    float _e40 = _group_0_binding_0_fs.metalRoughness;
    float brushAmount = (0.004 + (clamp(_e40, 0.0, 1.0) * 0.014));
    float _e48 = glsChromaticMetalTone(_e2);
    float tone = clamp((_e48 + (brushed * brushAmount)), 0.0, 1.0);
    vec4 _e56 = _group_0_binding_0_fs.colorD;
    vec4 _e60 = _group_0_binding_0_fs.colorB;
    vec4 _e64 = _group_0_binding_0_fs.colorC;
    vec4 _e68 = _group_0_binding_0_fs.colorA;
    vec3 _e70 = lqRamp(tone, _e56.xyz, _e60.xyz, _e64.xyz, _e68.xyz);
    return _e70;
}

vec3 glsChromaticMetalFluid(vec2 p_15, float t_12) {
    vec3 color_6 = vec3(0.0);
    float _e4 = _group_0_binding_0_fs.metalAngle;
    float angle_4 = (_e4 * 0.017453292);
    vec2 _e10 = glsRotate(vec2(0.0, 1.0), angle_4);
    float _e13 = _group_0_binding_0_fs.chromaticShift;
    vec2 split = ((_e10 * _e13) * 0.045);
    vec3 _e18 = glsChromaticMetalSample((p_15 + split), t_12);
    vec3 _e19 = glsChromaticMetalSample(p_15, t_12);
    vec3 _e21 = glsChromaticMetalSample((p_15 - split), t_12);
    vec3 optical = vec3(_e18.x, _e19.y, _e21.z);
    float fringe = clamp((length((optical - _e19)) * 4.0), 0.0, 1.0);
    float _e35 = _group_0_binding_0_fs.chromaticShift;
    color_6 = mix(_e19, optical, clamp((_e35 * (0.72 + (fringe * 0.28))), 0.0, 1.0));
    float _e46 = glsChromaticMetalPhase(p_15, t_12);
    float _e47 = glsChromaticMetalTone(_e46);
    float _e50 = _group_0_binding_0_fs.metalRoughness;
    float glint = pow(_e47, mix(12.0, 5.0, clamp(_e50, 0.0, 1.0)));
    vec3 _e58 = color_6;
    vec4 _e61 = _group_0_binding_0_fs.highlightColor;
    float _e65 = _group_0_binding_0_fs.metalDepth;
    color_6 = mix(_e58, _e61.xyz, ((glint * clamp(_e65, 0.0, 1.0)) * 0.06));
    float radial2_ = clamp(dot(p_15, p_15), 0.0, 1.0);
    vec3 normal_1 = normalize(vec3(p_15, sqrt(max((1.0 - radial2_), 0.0))));
    float _e86 = _group_0_binding_0_fs.metalRoughness;
    float roughness_1 = clamp(_e86, 0.0, 1.0);
    float _e92 = _group_0_binding_0_fs.metalDepth;
    float depth_1 = clamp(_e92, 0.0, 1.0);
    float key = pow(max(dot(normal_1, vec3(-0.4801921, 0.62024814, 0.62024814)), 0.0), mix(7.0, 3.0, roughness_1));
    float fill = pow(max(dot(normal_1, vec3(0.69912666, -0.3395758, 0.629214)), 0.0), mix(10.0, 4.0, roughness_1));
    float limb = (1.0 - normal_1.z);
    float fresnel = pow(limb, 3.0);
    float rim = pow(limb, 10.0);
    vec3 _e125 = color_6;
    color_6 = (_e125 * (0.86 + (normal_1.z * 0.14)));
    vec3 _e132 = color_6;
    vec4 _e135 = _group_0_binding_0_fs.highlightColor;
    color_6 = mix(_e132, _e135.xyz, (key * (0.05 + (depth_1 * 0.13))));
    vec3 _e143 = color_6;
    vec4 _e146 = _group_0_binding_0_fs.colorC;
    color_6 = mix(_e143, _e146.xyz, (fill * (0.025 + (depth_1 * 0.07))));
    vec3 _e154 = color_6;
    vec4 _e157 = _group_0_binding_0_fs.colorD;
    color_6 = mix(_e154, _e157.xyz, (fresnel * (0.12 + (depth_1 * 0.15))));
    vec3 _e165 = color_6;
    vec4 _e168 = _group_0_binding_0_fs.highlightColor;
    color_6 = mix(_e165, _e168.xyz, (rim * (0.035 + (depth_1 * 0.055))));
    vec3 _e176 = color_6;
    vec3 _e177 = glsFinishPresetFluid(_e176, p_15);
    return _e177;
}

vec3 glsOpalFluid(vec2 p_16, float t_13) {
    float d = 0.0;
    float a_2 = 0.0;
    int i_3 = 0;
    vec3 color_7 = vec3(0.0);
    float _e4 = _group_0_binding_0_fs.zoom;
    vec2 q_10 = (p_16 * (0.8 + (_e4 * 0.64)));
    float _e12 = _group_0_binding_0_fs.warp;
    float complexity = (0.76 + (_e12 * 0.085));
    d = (-(t_13) * 0.42);
    bool loop_init_3 = true;
    while(true) {
        if (!loop_init_3) {
            int _e48 = i_3;
            i_3 = (_e48 + 1);
        }
        loop_init_3 = false;
        int _e25 = i_3;
        if ((_e25 < 8)) {
        } else {
            break;
        }
        {
            int _e28 = i_3;
            float fi_1 = float(_e28);
            float _e30 = a_2;
            float _e31 = d;
            float _e33 = a_2;
            a_2 = (_e30 + cos(((fi_1 - _e31) - ((_e33 * q_10.x) * complexity))));
            float _e40 = d;
            float _e44 = a_2;
            d = (_e40 + sin((((q_10.y * fi_1) * complexity) + _e44)));
        }
    }
    float _e51 = d;
    d = (_e51 + (t_13 * 0.42));
    float _e55 = d;
    float _e56 = a_2;
    vec2 c1_ = ((cos((q_10 * vec2(_e55, _e56))) * 0.6) + vec2(0.4));
    float _e65 = a_2;
    float _e66 = d;
    float c2_ = ((cos((_e65 + _e66)) * 0.5) + 0.5);
    float _e76 = d;
    float _e77 = a_2;
    vec3 interference = (vec3(0.5) + (0.5 * cos((((vec3(c1_.x, c1_.y, c2_) * cos(vec3(_e76, _e77, 2.5))) * 0.5) + vec3(0.5)))));
    float tone_1 = fract((((((interference.x * 0.37) + (interference.y * 0.51)) + (interference.z * 0.73)) + (c1_.x * 0.22)) - (c1_.y * 0.15)));
    vec4 _e115 = _group_0_binding_0_fs.colorB;
    vec4 _e119 = _group_0_binding_0_fs.colorC;
    vec4 _e123 = _group_0_binding_0_fs.colorD;
    vec4 _e127 = _group_0_binding_0_fs.colorA;
    vec3 _e129 = lqRamp(tone_1, _e115.xyz, _e119.xyz, _e123.xyz, _e127.xyz);
    color_7 = _e129;
    vec3 _e131 = color_7;
    vec4 _e134 = _group_0_binding_0_fs.colorA;
    color_7 = mix(_e131, _e134.xyz, (0.16 + (0.1 * interference.z)));
    vec3 _e142 = color_7;
    vec3 _e145 = color_7;
    color_7 = (_e142 / (vec3(1.0) + (_e145 * 0.16)));
    vec3 _e150 = color_7;
    vec3 _e151 = glsFinishPresetFluid(_e150, p_16);
    return _e151;
}

vec3 glsFrostFluid(vec2 p_17, float t_14) {
    vec2 q_5 = vec2(0.0);
    vec3 color_8 = vec3(0.0);
    float _e4 = _group_0_binding_0_fs.zoom;
    q_5 = (p_17 * (0.66 + (_e4 * 0.92)));
    float _e13 = q_5.y;
    q_5.y = (_e13 + (t_14 * 0.055));
    float _e19 = _group_0_binding_0_fs.zoom;
    float blur = (0.011 + (0.006 * _e19));
    vec2 _e24 = q_5;
    vec2 _e32 = lqFbm(((_e24 * 1.14) + vec2((t_14 * 0.055), 0.0)), blur);
    vec2 _e34 = q_5;
    vec2 _e43 = lqFbm(((_e34 * 1.14) + vec2(6.8, (-(t_14) * 0.048))), blur);
    vec2 warpField = vec2(_e32.x, _e43.x);
    vec2 _e46 = q_5;
    float _e52 = _group_0_binding_0_fs.warp;
    vec2 warped = (_e46 + ((warpField - vec2(0.5)) * (0.28 + (_e52 * 0.17))));
    vec2 _e70 = lqFbm(((warped * 1.48) + vec2((t_14 * 0.032), (-(t_14) * 0.02))), (blur * 1.48));
    vec2 _e81 = lqFbm(((warped * 2.36) + vec2(3.1, (-(t_14) * 0.024))), (blur * 2.36));
    float _e84 = _group_0_binding_0_fs.sharp;
    float _e85 = lqRidgeS(_e81, _e84);
    float _e88 = lqStepS(_e70, 0.1, 0.9);
    float _e100 = _group_0_binding_0_fs.ridgeAmt;
    float value_1 = mix(_e88, clamp(((_e85 * 0.8) + (_e70.x * 0.46)), 0.0, 1.0), _e100);
    vec4 _e104 = _group_0_binding_0_fs.colorA;
    vec4 _e108 = _group_0_binding_0_fs.colorB;
    vec4 _e112 = _group_0_binding_0_fs.colorC;
    vec4 _e116 = _group_0_binding_0_fs.colorD;
    vec3 _e118 = lqRamp(value_1, _e104.xyz, _e108.xyz, _e112.xyz, _e116.xyz);
    color_8 = _e118;
    vec3 _e120 = color_8;
    vec4 _e123 = _group_0_binding_0_fs.colorA;
    color_8 = mix(_e120, _e123.xyz, (0.08 * smoothstep(0.62, 0.92, _e70.x)));
    vec3 _e132 = color_8;
    vec3 _e133 = glsFinishPresetFluid(_e132, p_17);
    return _e133;
}

vec3 glsVoiceWaveFluid(vec2 p_18, float t_15) {
    vec3 color_9 = vec3(0.0);
    float _e4 = _group_0_binding_0_fs.zoom;
    float scale_4 = (0.76 + (_e4 * 0.34));
    vec2 q_11 = (p_18 / vec2(scale_4));
    float rimEnvelope = pow(max((1.0 - (q_11.x * q_11.x)), 0.0), 0.72);
    float drift_3 = (t_15 * 0.82);
    float _e24 = _group_0_binding_0_fs.warp;
    float amplitude_4 = (0.2 + (_e24 * 0.018));
    float mainY_2 = (rimEnvelope * ((amplitude_4 * sin(((q_11.x * 1.48) + drift_3))) + (0.055 * sin((((q_11.x * 3.2) - (drift_3 * 0.43)) + 1.1)))));
    float distance_ = (q_11.y - mainY_2);
    float _e52 = _group_0_binding_0_fs.ridgeAmt;
    float width = (0.11 + ((1.0 - _e52) * 0.075));
    float membrane = (exp(((-(distance_) * distance_) / max((width * width), 0.001))) * rimEnvelope);
    float upperVeil = (exp(((-((distance_ - 0.105)) * (distance_ - 0.105)) / max(((width * width) * 2.4), 0.001))) * rimEnvelope);
    float lowerVeil = (exp(((-((distance_ + 0.115)) * (distance_ + 0.115)) / max(((width * width) * 2.8), 0.001))) * rimEnvelope);
    float crest = (exp(((-(distance_) * distance_) / 0.0026)) * rimEnvelope);
    float depth_2 = sqrt(max((1.0 - clamp(dot(p_18, p_18), 0.0, 1.0)), 0.0));
    vec4 _e112 = _group_0_binding_0_fs.colorA;
    vec4 _e118 = _group_0_binding_0_fs.colorD;
    color_9 = mix((_e112.xyz * 0.7), (_e118.xyz * 0.34), smoothstep(-0.82, 0.82, q_11.y));
    vec3 _e128 = color_9;
    vec4 _e131 = _group_0_binding_0_fs.colorB;
    color_9 = mix(_e128, _e131.xyz, (upperVeil * 0.7));
    vec3 _e136 = color_9;
    vec4 _e139 = _group_0_binding_0_fs.colorC;
    color_9 = mix(_e136, _e139.xyz, (lowerVeil * 0.62));
    vec3 _e144 = color_9;
    vec4 _e147 = _group_0_binding_0_fs.colorB;
    vec4 _e151 = _group_0_binding_0_fs.colorC;
    color_9 = (_e144 + ((mix(_e147.xyz, _e151.xyz, 0.46) * membrane) * 0.34));
    vec3 _e159 = color_9;
    vec4 _e162 = _group_0_binding_0_fs.highlightColor;
    color_9 = (_e159 + ((_e162.xyz * crest) * 0.14));
    vec3 _e168 = color_9;
    color_9 = (_e168 * (0.58 + (0.42 * depth_2)));
    vec3 _e174 = color_9;
    vec3 _e175 = glsFinishPresetFluid(_e174, p_18);
    return _e175;
}

vec3 glsBlueDropFluid(vec2 p_19, float t_16) {
    vec2 q_6 = vec2(0.0);
    vec2 flowed = vec2(0.0);
    vec3 color_10 = vec3(0.0);
    float depth_3 = sqrt(max((1.0 - clamp(dot(p_19, p_19), 0.0, 1.0)), 0.0));
    q_6 = (p_19 * mix(0.72, 1.0, ((depth_3 * 0.62) + 0.38)));
    vec2 _e20 = q_6;
    vec2 _e28 = glsRotate(_e20, (-0.24 + (0.06 * sin((t_16 * 0.17)))));
    q_6 = _e28;
    float _e31 = _group_0_binding_0_fs.zoom;
    float scale_5 = (1.0 + (_e31 * 1.12));
    float _e38 = _group_0_binding_0_fs.zoom;
    float blur_1 = (0.012 + (0.006 * _e38));
    vec2 _e43 = q_6;
    vec2 _e55 = lqFbm(((_e43 * 1.28) + vec2((t_16 * 0.095), (-(t_16) * 0.034))), (blur_1 * 1.28));
    vec2 _e56 = q_6;
    vec2 _e58 = glsRotate(_e56, 1.08);
    vec2 _e70 = lqFbm(((_e58 * 1.62) + vec2((-(t_16) * 0.042), (t_16 * 0.078))), (blur_1 * 1.62));
    vec2 _e71 = q_6;
    float _e81 = _group_0_binding_0_fs.warp;
    flowed = (_e71 + (vec2((_e55.x - 0.5), (_e70.x - 0.5)) * (0.24 + (_e81 * 0.1))));
    float _e91 = flowed.x;
    float _e93 = flowed.y;
    float _e102 = _group_0_binding_0_fs.warp;
    flowed.x = (_e91 + (sin(((_e93 * 2.15) + (t_16 * 0.24))) * (0.035 + (_e102 * 0.012))));
    float _e111 = flowed.y;
    float _e113 = flowed.x;
    float _e122 = _group_0_binding_0_fs.warp;
    flowed.y = (_e111 + (sin(((_e113 * 1.38) - (t_16 * 0.18))) * (0.045 + (_e122 * 0.01))));
    vec2 _e129 = flowed;
    vec2 _e139 = lqFbm(((_e129 * scale_5) + vec2((t_16 * 0.025), (-(t_16) * 0.018))), (blur_1 * scale_5));
    vec2 _e140 = flowed;
    float _e143 = _group_0_binding_0_fs.zoom;
    float _e157 = _group_0_binding_0_fs.zoom;
    vec2 _e163 = lqFbm(((_e140 * (1.72 + (_e143 * 0.9))) + vec2(2.7, (-(t_16) * 0.035))), (blur_1 * (1.72 + (_e157 * 0.9))));
    float _e166 = _group_0_binding_0_fs.sharp;
    float _e171 = lqRidgeS(_e163, (0.8 + (_e166 * 0.46)));
    float _e181 = _group_0_binding_0_fs.ridgeAmt;
    float value_2 = clamp(mix(_e139.x, ((_e139.x * 0.62) + (_e171 * 0.58)), _e181), 0.0, 1.0);
    vec4 _e188 = _group_0_binding_0_fs.colorA;
    vec4 _e192 = _group_0_binding_0_fs.colorB;
    vec4 _e196 = _group_0_binding_0_fs.colorC;
    vec4 _e200 = _group_0_binding_0_fs.colorD;
    vec3 _e202 = lqRamp(value_2, _e188.xyz, _e192.xyz, _e196.xyz, _e200.xyz);
    color_10 = _e202;
    float light = pow(max(dot(normalize(vec3(p_19, depth_3)), vec3(-0.39708766, 0.51290494, 0.76108474)), 0.0), 3.2);
    vec3 _e215 = color_10;
    vec4 _e218 = _group_0_binding_0_fs.highlightColor;
    float _e222 = _group_0_binding_0_fs.shade;
    color_10 = mix(_e215, _e218.xyz, (light * (0.035 + (0.05 * _e222))));
    vec3 _e229 = color_10;
    color_10 = (_e229 * (0.74 + (0.26 * depth_3)));
    vec3 _e235 = color_10;
    vec3 _e236 = glsFinishPresetFluid(_e235, p_19);
    return _e236;
}

vec3 glsVioletEmberFluid(vec2 p_20, float t_17) {
    vec3 color_11 = vec3(0.0);
    float _e4 = _group_0_binding_0_fs.zoom;
    float scale_6 = (1.08 + (_e4 * 1.18));
    float _e11 = _group_0_binding_0_fs.zoom;
    float blur_2 = (0.011 + (0.005 * _e11));
    float radius = length(p_20);
    float _e21 = _group_0_binding_0_fs.warp;
    float twist = (((t_17 * 0.055) + (radius * (0.72 + (_e21 * 0.11)))) + (0.08 * sin(((t_17 * 0.31) + (radius * 4.0)))));
    vec2 _e38 = glsRotate((p_20 * scale_6), twist);
    vec2 _e50 = lqFbm(((_e38 * 1.18) + vec2((t_17 * 0.068), (-(t_17) * 0.105))), (blur_2 * 1.18));
    vec2 _e52 = glsRotate(_e38, -1.12);
    vec2 _e73 = lqFbm((((_e52 * 1.52) + vec2((-(t_17) * 0.094), (t_17 * 0.042))) + vec2((_e50.x * 1.35), (-(_e50.x) * 0.72))), (blur_2 * 1.52));
    float _e83 = _group_0_binding_0_fs.warp;
    vec2 warped_1 = (_e38 + (vec2((_e50.x - 0.5), (_e73.x - 0.5)) * (0.3 + (_e83 * 0.12))));
    vec2 _e102 = lqFbm(((warped_1 * 1.34) + vec2((_e73.x * 1.48), (_e50.x * 1.12))), (blur_2 * 1.34));
    float _e105 = _group_0_binding_0_fs.zoom;
    float _e118 = _group_0_binding_0_fs.zoom;
    vec2 _e124 = lqFbm(((warped_1 * (2.05 + (_e105 * 0.72))) + vec2(-2.1, (t_17 * 0.052))), (blur_2 * (2.05 + (_e118 * 0.72))));
    float _e127 = _group_0_binding_0_fs.sharp;
    float _e132 = lqRidgeS(_e124, (0.82 + (_e127 * 0.58)));
    float _e136 = _group_0_binding_0_fs.ridgeAmt;
    float _e144 = _group_0_binding_0_fs.ridgeAmt;
    float heat = smoothstep(0.18, 0.92, ((_e102.x * (0.72 - (_e136 * 0.16))) + (_e132 * (0.32 + (_e144 * 0.5)))));
    vec4 _e156 = _group_0_binding_0_fs.colorA;
    vec4 _e160 = _group_0_binding_0_fs.colorB;
    vec4 _e164 = _group_0_binding_0_fs.colorC;
    vec4 _e168 = _group_0_binding_0_fs.colorD;
    vec3 _e170 = lqRamp(heat, _e156.xyz, _e160.xyz, _e164.xyz, _e168.xyz);
    color_11 = _e170;
    float pulse = (0.94 + (0.06 * sin(((t_17 * 0.44) + (_e102.x * 5.0)))));
    vec3 _e183 = color_11;
    color_11 = (_e183 * pulse);
    vec3 _e185 = color_11;
    vec4 _e188 = _group_0_binding_0_fs.highlightColor;
    color_11 = mix(_e185, _e188.xyz, (pow(_e132, 4.0) * 0.045));
    vec3 _e195 = color_11;
    vec3 _e196 = glsFinishPresetFluid(_e195, p_20);
    return _e196;
}

vec3 glsPresetFluid(vec2 p_21, int style, float t_18) {
    if ((style == 9)) {
        vec3 _e5 = glsSiriFluid(p_21, t_18);
        return _e5;
    }
    if ((style == 10)) {
        vec3 _e8 = glsAuroraFluid(p_21, t_18);
        return _e8;
    }
    if ((style == 11)) {
        vec3 _e11 = glsPlasmaFluid(p_21, t_18);
        return _e11;
    }
    if ((style == 12)) {
        vec3 _e14 = glsChromeFluid(p_21, t_18);
        return _e14;
    }
    if ((style == 13)) {
        vec3 _e17 = glsOpalFluid(p_21, t_18);
        return _e17;
    }
    if ((style == 14)) {
        vec3 _e20 = glsSpectrumFluid(p_21, t_18);
        return _e20;
    }
    if ((style == 15)) {
        vec3 _e23 = glsFrostFluid(p_21, t_18);
        return _e23;
    }
    if ((style == 19)) {
        vec3 _e26 = glsVoiceWaveFluid(p_21, t_18);
        return _e26;
    }
    if ((style == 20)) {
        vec3 _e29 = glsBlueDropFluid(p_21, t_18);
        return _e29;
    }
    if ((style == 21)) {
        vec3 _e32 = glsVioletEmberFluid(p_21, t_18);
        return _e32;
    }
    if ((style == 22)) {
        vec3 _e35 = glsChromaticMetalFluid(p_21, t_18);
        return _e35;
    }
    vec3 _e36 = glsFrostFluid(p_21, t_18);
    return _e36;
}

vec3 glsFluid(vec2 fu, int md, float t_19) {
    vec3 fcol = vec3(0.0);
    vec2 pp = vec2(0.0);
    float v_2 = 0.0;
    float df = length(fu);
    vec4 _e6 = _group_0_binding_0_fs.colorA;
    vec3 cA_1 = _e6.xyz;
    vec4 _e10 = _group_0_binding_0_fs.colorB;
    vec3 cB_1 = _e10.xyz;
    vec4 _e14 = _group_0_binding_0_fs.colorC;
    vec3 cC_1 = _e14.xyz;
    vec4 _e18 = _group_0_binding_0_fs.colorD;
    vec3 cD_1 = _e18.xyz;
    float _e24 = _group_0_binding_0_fs.glassEnabled;
    float blurSigma = ((_e24 > 0.5) ? GL_BSIG_GLASS : GL_BSIG_CLEAR);
    float _e30 = _group_0_binding_0_fs.zoom;
    float sp = (blurSigma * _e30);
    float sw = ((sp * 1.1) * GL_KWA);
    if ((md < 0)) {
        float _e41 = _group_0_binding_0_fs.zoom;
        pp = (fu * _e41);
        float _e46 = pp.y;
        pp.y = (_e46 + (t_19 * 0.05));
        vec2 _e50 = pp;
        vec2 _e58 = lqFbm(((_e50 * 1.1) + vec2(0.0, (t_19 * 0.09))), sw);
        vec2 _e60 = pp;
        vec2 _e69 = lqFbm(((_e60 * 1.1) + vec2(7.7, (-(t_19) * 0.07))), sw);
        vec2 w = vec2(_e58.x, _e69.x);
        vec2 _e72 = pp;
        float _e75 = _group_0_binding_0_fs.warp;
        vec2 q_12 = (_e72 + (_e75 * (w - vec2(0.5))));
        vec2 _e90 = lqFbm(((q_12 * 1.5) + vec2((t_19 * 0.04), 0.0)), (sp * 1.5));
        vec2 _e98 = lqFbm(((q_12 * 2.2) + vec2(3.1)), (sp * 2.2));
        float _e101 = _group_0_binding_0_fs.sharp;
        float _e102 = lqRidgeS(_e98, _e101);
        float _e105 = lqStepS(_e90, 0.12, 0.88);
        float _e117 = _group_0_binding_0_fs.ridgeAmt;
        float v_3 = mix(_e105, clamp(((_e102 * 0.85) + (0.45 * _e90.x)), 0.0, 1.0), _e117);
        vec3 _e119 = lqRamp(v_3, cA_1, cB_1, cC_1, cD_1);
        fcol = _e119;
    } else {
        float _e122 = _group_0_binding_0_fs.zoom;
        vec2 pp_1 = (fu * _e122);
        vec2 _e131 = lqFbm(((pp_1 * 1.1) + vec2(0.0, (t_19 * 0.09))), sw);
        vec2 _e141 = lqFbm(((pp_1 * 1.1) + vec2(7.7, (-(t_19) * 0.07))), sw);
        vec2 w_1 = vec2(_e131.x, _e141.x);
        float _e146 = _group_0_binding_0_fs.warp;
        vec2 q_13 = (pp_1 + (_e146 * (w_1 - vec2(0.5))));
        if ((md == 0)) {
            vec2 _e158 = lqFbm((q_13 * 2.2), (sp * 2.2));
            float damp = exp((((-18.0 * _e158.y) * _e158.y) - ((24.5 * sp) * sp)));
            v_2 = (0.5 + ((0.5 * damp) * sin((((q_13.x * 7.0) + (_e158.x * 6.0)) + (t_19 * 0.35)))));
            float _e186 = v_2;
            vec2 _e195 = lqFbm(((q_13 * 1.4) + vec2((t_19 * 0.03))), (sp * 1.4));
            v_2 = mix(_e186, _e195.x, 0.25);
            float _e199 = v_2;
            vec3 _e200 = lqRamp(_e199, cA_1, cB_1, cC_1, cD_1);
            fcol = _e200;
        } else {
            if ((md == 1)) {
                vec2 _e212 = lqFbm(((q_13 * 1.4) + vec2((t_19 * 0.06), 0.0)), (sp * 1.4));
                float _e215 = _group_0_binding_0_fs.sharp;
                float _e216 = lqRidgeS(_e212, _e215);
                vec2 _e226 = lqFbm(((q_13 * 1.7) - vec2(0.0, (t_19 * 0.05))), (sp * 1.7));
                float _e229 = _group_0_binding_0_fs.sharp;
                float _e230 = lqRidgeS(_e226, _e229);
                float v_4 = (_e216 * _e230);
                vec3 _e234 = lqRamp(pow(v_4, 0.7), cA_1, cB_1, cC_1, cD_1);
                fcol = _e234;
            } else {
                if ((md == 6)) {
                    vec2 _e247 = lqFbm(((q_13 * 2.6) + vec2((t_19 * 0.025))), (sp * 2.6));
                    vec2 _e255 = lqFbm(((q_13 * 1.3) + vec2((1.5 * _e247.x))), (sp * 1.3));
                    vec2 _e263 = lqFbm(((q_13 * 2.1) + vec2(7.0)), (sp * 2.1));
                    float _e265 = lqRidgeS(_e263, 1.3);
                    float _e268 = lqStepS(_e255, 0.1, 0.9);
                    vec3 _e269 = lqRamp(_e268, cA_1, cB_1, cC_1, cD_1);
                    fcol = _e269;
                    vec3 _e270 = fcol;
                    fcol = (_e270 * (1.0 - (0.18 * _e265)));
                } else {
                    vec2 q2_ = (q_13 + vec2(0.0, (-(t_19) * 0.14)));
                    vec2 _e294 = lqFbm(((q2_ * 2.4) + vec2(0.0, (-(t_19) * 0.05))), (sp * 2.4));
                    vec2 _e302 = lqFbm(((q2_ * 1.6) + vec2((2.2 * _e294.x))), (sp * 1.6));
                    float _e304 = lqPowS(_e302, 1.5);
                    vec3 _e305 = lqRamp(_e304, cA_1, cB_1, cC_1, cD_1);
                    fcol = _e305;
                }
            }
        }
    }
    vec3 _e306 = fcol;
    vec4 _e309 = _group_0_binding_0_fs.highlightColor;
    float _e313 = _group_0_binding_0_fs.shade;
    fcol = mix(_e306, _e309.xyz, ((_e313 * 0.3) * smoothstep(0.25, 1.25, dot(fu, vec2(-0.32, 0.78)))));
    vec3 _e325 = fcol;
    float _e328 = _group_0_binding_0_fs.shade;
    fcol = (_e325 * (1.0 - ((_e328 * 0.42) * smoothstep(-0.05, 1.25, dot(fu, vec2(0.45, -0.62))))));
    vec3 _e342 = fcol;
    float _e345 = _group_0_binding_0_fs.shade;
    fcol = (_e342 * (1.0 - ((_e345 * 0.3) * smoothstep(0.72, 1.0, df))));
    vec3 _e355 = fcol;
    return clamp(_e355, vec3(0.0), vec3(1.0));
}

vec3 glsOver(vec3 dst, vec3 src, float a_3) {
    float k_5 = clamp(a_3, 0.0, 1.0);
    return ((src * k_5) + (dst * (1.0 - k_5)));
}

float glsRefractionProfile(float t_20) {
    float depth_4 = clamp(t_20, 0.0, 1.0);
    float circular = sqrt(max((1.0 - ((1.0 - depth_4) * (1.0 - depth_4))), 0.0));
    return (1.0 - circular);
}

float glsHighlightLobe(vec2 normal, vec2 direction, float cut, float power) {
    float angular = clamp(((dot(normal, direction) - cut) / max((1.0 - cut), 0.001)), 0.0, 1.0);
    return pow(angular, power);
}

vec2 glsContourWave(float angle_1, float t_21) {
    float _e4 = _group_0_binding_0_fs.style;
    int style_1 = int((_e4 + 0.5));
    if ((style_1 == 19)) {
        float wave_2 = ((sin(((angle_1 * 2.0) + (t_21 * 0.27))) * 0.72) + (sin((((angle_1 * 4.0) - (t_21 * 0.16)) + 2.1)) * 0.28));
        float slope = ((cos(((angle_1 * 2.0) + (t_21 * 0.27))) * 1.44) + (cos((((angle_1 * 4.0) - (t_21 * 0.16)) + 2.1)) * 1.12));
        return vec2(wave_2, slope);
    }
    float wave_3 = (((sin(((angle_1 * 3.0) + (t_21 * 0.62))) * 0.52) + (sin((((angle_1 * 5.0) - (t_21 * 0.41)) + 1.7)) * 0.31)) + (sin((((angle_1 * 2.0) + (t_21 * 0.23)) + 3.1)) * 0.17));
    float slope_1 = (((cos(((angle_1 * 3.0) + (t_21 * 0.62))) * 1.56) + (cos((((angle_1 * 5.0) - (t_21 * 0.41)) + 1.7)) * 1.55)) + (cos((((angle_1 * 2.0) + (t_21 * 0.23)) + 3.1)) * 0.34));
    return vec2(wave_3, slope_1);
}

float glsContourStrength() {
    float _e2 = _group_0_binding_0_fs.style;
    if ((_e2 >= 18.5)) {
        return 0.11;
    }
    float _e8 = _group_0_binding_0_fs.style;
    return ((_e8 >= 15.5) ? 0.16 : 0.09);
}

float glsContourScale(vec2 uv_1, float t_22, float amount) {
    if ((amount <= 0.0)) {
        return 1.0;
    }
    vec2 _e9 = glsContourWave(atan(uv_1.y, uv_1.x), t_22);
    float _e13 = glsContourStrength();
    return (1.0 + ((clamp(amount, 0.0, 1.0) * _e13) * _e9.x));
}

vec2 glsContourNormal(vec2 uv_2, float rad_1, float t_23, float amount_1) {
    float distance_1 = length(uv_2);
    if ((distance_1 <= 0.0001)) {
        return vec2(0.0);
    }
    vec2 radial = (uv_2 / vec2(distance_1));
    vec2 _e14 = glsContourWave(atan(uv_2.y, uv_2.x), t_23);
    float _e18 = glsContourStrength();
    float slope_2 = ((clamp(amount_1, 0.0, 1.0) * _e18) * _e14.y);
    vec2 tangent = vec2(-(radial.y), radial.x);
    return normalize((radial - (tangent * ((rad_1 * slope_2) / distance_1))));
}

vec4 orbGlassLiquidAnim(vec2 uv01_) {
    int md_1 = -1;
    bool local = false;
    vec3 fcol_1 = vec3(0.0);
    vec3 col_1 = vec3(0.0);
    vec2 _e8 = _group_0_binding_0_fs.size;
    vec2 fc = (vec2(uv01_.x, (1.0 - uv01_.y)) * _e8);
    vec2 _e14 = _group_0_binding_0_fs.size;
    float _e19 = _group_0_binding_0_fs.size.x;
    float _e23 = _group_0_binding_0_fs.size.y;
    vec2 uv_3 = (((2.0 * fc) - _e14) / vec2(max(min(_e19, _e23), 1.0)));
    float _e31 = _group_0_binding_0_fs.radius;
    float rad_2 = max(_e31, 0.05);
    float _e36 = _group_0_binding_0_fs.time;
    float _e39 = _group_0_binding_0_fs.speed;
    float t_24 = (_e36 * _e39);
    float _e43 = _group_0_binding_0_fs.contourDeform;
    float _e44 = glsContourScale(uv_3, t_24, _e43);
    float contourRad = (rad_2 * _e44);
    float _e49 = _group_0_binding_0_fs.edgeSoftness;
    float _e50 = mfEdgeD(_e49);
    if ((length(uv_3) > (contourRad * (1.01 + _e50)))) {
        float _e61 = _group_0_binding_0_fs.edgeSoftness;
        float _e64 = _group_0_binding_0_fs.edgeGlow;
        vec4 _e67 = _group_0_binding_0_fs.glowColor;
        vec3 _e69 = mfEdgeGlow(vec3(0.0), uv_3, vec2(0.0), contourRad, _e61, _e64, _e67.xyz);
        return vec4(clamp(_e69, vec3(0.0), vec3(1.0)), 1.0);
    }
    vec2 p_22 = (uv_3 / vec2(contourRad));
    float pd = length(p_22);
    vec2 fu_1 = (p_22 / vec2(0.8817204));
    float _e85 = _group_0_binding_0_fs.style;
    int s_2 = int((_e85 + 0.5));
    if ((s_2 == 1)) {
        md_1 = 1;
    } else {
        if (!((s_2 == 3))) {
            local = (s_2 == 8);
        } else {
            local = true;
        }
        bool _e102 = local;
        if (_e102) {
            md_1 = 7;
        } else {
            if ((s_2 == 5)) {
                md_1 = 6;
            } else {
                if ((s_2 == 7)) {
                    md_1 = 0;
                }
            }
        }
    }
    float clearFa = (1.0 - smoothstep(GL_CLEAR_EA, GL_CLEAR_EB, pd));
    float _e117 = _group_0_binding_0_fs.contourDeform;
    vec2 _e118 = glsContourNormal(uv_3, rad_2, t_24, _e117);
    float edgeDepth = max((1.0 - pd), 0.0);
    float _e125 = _group_0_binding_0_fs.shellMidAlpha;
    float refractionWidth = (0.015 + (0.95 * clamp(_e125, 0.0, 1.0)));
    float refractionT = (edgeDepth / max(refractionWidth, 0.001));
    float _e136 = glsRefractionProfile(refractionT);
    float refractionProfile = pow(_e136, 0.68);
    float _e141 = _group_0_binding_0_fs.glassOpacity;
    float refractionAmount = ((1.6 * clamp(_e141, 0.0, 1.0)) * refractionProfile);
    vec2 refractedP = (p_22 - (_e118 * refractionAmount));
    if ((clearFa > 0.0)) {
        if ((s_2 >= 9)) {
            float _e159 = _group_0_binding_0_fs.glassEnabled;
            if ((_e159 > 0.5)) {
                float _e164 = _group_0_binding_0_fs.gloss;
                float _e172 = _group_0_binding_0_fs.glassOpacity;
                float channelSplit = (((0.14 * clamp(_e164, 0.0, 2.0)) * clamp(_e172, 0.0, 1.0)) * refractionProfile);
                vec3 _e180 = glsPresetFluid((refractedP - (_e118 * channelSplit)), s_2, t_24);
                vec3 _e181 = glsPresetFluid(refractedP, s_2, t_24);
                vec3 _e184 = glsPresetFluid((refractedP + (_e118 * channelSplit)), s_2, t_24);
                fcol_1 = vec3(_e180.x, _e181.y, _e184.z);
            } else {
                vec3 _e189 = glsPresetFluid(p_22, s_2, t_24);
                fcol_1 = _e189;
            }
        } else {
            int _e190 = md_1;
            vec3 _e191 = glsFluid(fu_1, _e190, t_24);
            fcol_1 = _e191;
        }
    }
    vec3 _e192 = fcol_1;
    float lum = dot(_e192, vec3(0.213, 0.715, 0.072));
    vec3 _e199 = fcol_1;
    vec3 clearSat = clamp((vec3(lum) + ((_e199 - vec3(lum)) * 1.22)), vec3(0.0), vec3(1.0));
    vec4 _e212 = _group_0_binding_0_fs.canvasColor;
    vec3 _e216 = glsOver(_e212.xyz, clearSat, (0.99 * clearFa));
    col_1 = _e216;
    float _e220 = _group_0_binding_0_fs.glassEnabled;
    if ((_e220 > 0.5)) {
        float _e225 = _group_0_binding_0_fs.shellEdgeAlpha;
        float surfaceWidth = (0.026 + (0.055 * clamp(_e225, 0.0, 1.0)));
        float surfaceBand = ((1.0 - smoothstep(0.0, surfaceWidth, edgeDepth)) * clearFa);
        float opticalRim = pow(surfaceBand, 1.8);
        vec3 _e240 = col_1;
        vec4 _e243 = _group_0_binding_0_fs.shellInner;
        float _e247 = _group_0_binding_0_fs.glassOpacity;
        vec3 _e251 = glsOver(_e240, _e243.xyz, ((opticalRim * _e247) * 0.45));
        col_1 = _e251;
        vec2 coolDirection = vec2(0.8411784, 0.5407576);
        vec2 warmDirection = vec2(-0.6222442, -0.78282326);
        float _e260 = glsHighlightLobe(_e118, coolDirection, -0.32, 1.8);
        float _e263 = glsHighlightLobe(_e118, warmDirection, -0.28, 2.0);
        float _e266 = _group_0_binding_0_fs.gloss;
        float _e273 = _group_0_binding_0_fs.shellEdgeAlpha;
        float dispersion = ((opticalRim * clamp(_e266, 0.0, 2.0)) * (0.8 + (0.8 * _e273)));
        vec3 _e279 = col_1;
        vec4 _e282 = _group_0_binding_0_fs.shellMid;
        vec3 _e285 = glsOver(_e279, _e282.xyz, (dispersion * _e260));
        col_1 = _e285;
        vec3 _e286 = col_1;
        vec4 _e289 = _group_0_binding_0_fs.shellEdge;
        vec3 _e292 = glsOver(_e286, _e289.xyz, (dispersion * _e263));
        col_1 = _e292;
        float _e295 = _group_0_binding_0_fs.shellEdgeAlpha;
        float edgeShadow = ((opticalRim * (0.015 + (0.15 * _e295))) * (0.15 + (0.85 * max(dot(_e118, vec2(0.45, -0.89)), 0.0))));
        vec3 _e312 = col_1;
        col_1 = (_e312 * (1.0 - edgeShadow));
        vec2 keyDirection = vec2(-0.6816036, 0.7317216);
        vec2 fillDirection = vec2(0.74129844, -0.6711756);
        float _e324 = glsHighlightLobe(_e118, keyDirection, 0.2, 2.8);
        float _e328 = _group_0_binding_0_fs.sheen;
        float key_1 = (((opticalRim * _e324) * clamp(_e328, 0.0, 2.0)) * 1.4);
        float _e337 = glsHighlightLobe(_e118, fillDirection, 0.4, 3.6);
        float _e341 = _group_0_binding_0_fs.sheen;
        float fill_1 = (((opticalRim * _e337) * clamp(_e341, 0.0, 2.0)) * 1.0);
        vec3 _e348 = col_1;
        vec4 _e351 = _group_0_binding_0_fs.sheenColor;
        vec3 _e353 = glsOver(_e348, _e351.xyz, key_1);
        col_1 = _e353;
        vec3 _e354 = col_1;
        vec4 _e357 = _group_0_binding_0_fs.specColor;
        vec3 _e359 = glsOver(_e354, _e357.xyz, fill_1);
        col_1 = _e359;
    }
    float _e362 = _group_0_binding_0_fs.edgeSoftness;
    float _e363 = mfEdgeD(_e362);
    float _e368 = _group_0_binding_0_fs.edgeSoftness;
    float _e369 = mfEdgeD(_e368);
    float ballA = (1.0 - smoothstep((0.99 - _e363), (1.01 + _e369), pd));
    vec3 _e375 = col_1;
    float _e378 = _group_0_binding_0_fs.exposure;
    col_1 = (clamp((_e375 * max(_e378, 0.0)), vec3(0.0), vec3(1.0)) * ballA);
    vec3 _e388 = col_1;
    float _e393 = _group_0_binding_0_fs.edgeSoftness;
    float _e396 = _group_0_binding_0_fs.edgeGlow;
    vec4 _e399 = _group_0_binding_0_fs.glowColor;
    vec3 _e401 = mfEdgeGlow(_e388, uv_3, vec2(0.0), contourRad, _e393, _e396, _e399.xyz);
    return vec4(clamp(_e401, vec3(0.0), vec3(1.0)), 1.0);
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    vec4 _e2 = orbGlassLiquidAnim(in_.uv);
    vec2 _e12 = _group_0_binding_0_fs.size;
    vec2 fc_1 = (vec2(in_.uv.x, (1.0 - in_.uv.y)) * _e12);
    vec2 _e18 = _group_0_binding_0_fs.size;
    float _e23 = _group_0_binding_0_fs.size.x;
    float _e27 = _group_0_binding_0_fs.size.y;
    vec2 uv_4 = (((2.0 * fc_1) - _e18) / vec2(max(min(_e23, _e27), 1.0)));
    float _e35 = _group_0_binding_0_fs.radius;
    float rad_3 = max(_e35, 0.05);
    float _e40 = _group_0_binding_0_fs.time;
    float _e43 = _group_0_binding_0_fs.speed;
    float t_25 = (_e40 * _e43);
    float _e47 = _group_0_binding_0_fs.contourDeform;
    float _e48 = glsContourScale(uv_4, t_25, _e47);
    float contourRad_1 = (rad_3 * _e48);
    float pd_1 = (length(uv_4) / contourRad_1);
    float _e54 = _group_0_binding_0_fs.edgeSoftness;
    float _e55 = mfEdgeD(_e54);
    float _e60 = _group_0_binding_0_fs.edgeSoftness;
    float _e61 = mfEdgeD(_e60);
    float ballA_1 = (1.0 - smoothstep((0.99 - _e55), (1.01 + _e61), pd_1));
    float lum_1 = max(_e2.x, max(_e2.y, _e2.z));
    vec2 _e76 = _group_0_binding_0_fs.size;
    vec2 _e80 = _group_0_binding_0_fs.size;
    vec2 q_14 = (((2.0 * fc_1) - _e76) / _e80);
    float _e86 = _group_0_binding_0_fs.size.x;
    float _e90 = _group_0_binding_0_fs.size.y;
    float fitFeather = (2.0 / max(min(_e86, _e90), 1.0));
    float fitStart = min(mix(contourRad_1, 1.0, 0.5), (1.0 - fitFeather));
    float fit = (1.0 - smoothstep(fitStart, 1.0, max(abs(q_14.x), abs(q_14.y))));
    float materialAlpha = ((clamp((0.015 + (pow(clamp(lum_1, 0.0, 1.0), 1.15) * 0.62)), 0.0, 0.68) * ballA_1) * fit);
    _fs2p_location0 = vec4((_e2.xyz * materialAlpha), materialAlpha);
    return;
}
