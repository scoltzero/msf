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

smooth out vec2 _vs2fs_location0;

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

vec2 glsSiriBand(vec2 q, float drift, float phaseOffset, float amplitude, float mainY, float envelope, float softness) {
    float y = ((amplitude * envelope) * sin((((q.x * 1.0) + drift) + phaseOffset)));
    float distanceToLine = abs((q.y - y));
    float line = (0.018 / (sqrt(((distanceToLine * distanceToLine) + (softness * softness))) + 0.026));
    float bandDistance = max(0.0, max((q.y - max(mainY, y)), (min(mainY, y) - q.y)));
    float band = (0.018 / (bandDistance + 0.075));
    return vec2(line, band);
}

float glsSpectrumHeight(vec2 q_1, float t_3, float frequency, float phaseOffset_1, float amplitude_1) {
    float x_2 = (q_1.x * 2.15);
    float envelope_1 = pow((4.0 / (4.0 + (x_2 * x_2))), 4.0);
    float breathing = (0.82 + (0.18 * sin(((t_3 * 0.48) + (phaseOffset_1 * 0.7)))));
    float wave = abs(sin((((frequency * x_2) - (t_3 * 1.36)) + phaseOffset_1)));
    return (((envelope_1 * amplitude_1) * breathing) * (0.28 + (0.72 * wave)));
}

float glsSpectrumLayer(vec2 q_2, float height, float softness_1) {
    return ((1.0 - smoothstep(max((height - softness_1), 0.0), (height + softness_1), abs(q_2.y))) * smoothstep(0.0, 0.045, height));
}

vec2 glsRotate(vec2 p_9, float angle) {
    float c_1 = cos(angle);
    float s_1 = sin(angle);
    return vec2(((c_1 * p_9.x) - (s_1 * p_9.y)), ((s_1 * p_9.x) + (c_1 * p_9.y)));
}

vec3 glsOver(vec3 dst, vec3 src, float a_3) {
    float k_5 = clamp(a_3, 0.0, 1.0);
    return ((src * k_5) + (dst * (1.0 - k_5)));
}

float glsRefractionProfile(float t_20) {
    float depth = clamp(t_20, 0.0, 1.0);
    float circular = sqrt(max((1.0 - ((1.0 - depth) * (1.0 - depth))), 0.0));
    return (1.0 - circular);
}

float glsHighlightLobe(vec2 normal, vec2 direction, float cut, float power) {
    float angular = clamp(((dot(normal, direction) - cut) / max((1.0 - cut), 0.001)), 0.0, 1.0);
    return pow(angular, power);
}

void main() {
    uint i = uint(gl_VertexID);
    vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    VOut out_ = VOut(vec4(0.0), vec2(0.0));
    vec2 _e15 = p[i];
    out_.pos = vec4(_e15, 0.0, 1.0);
    vec2 _e20 = p[i];
    vec2 uv01_1 = ((_e20 + vec2(1.0)) * 0.5);
    out_.uv = vec2(uv01_1.x, (1.0 - uv01_1.y));
    VOut _e32 = out_;
    gl_Position = _e32.pos;
    _vs2fs_location0 = _e32.uv;
    return;
}
