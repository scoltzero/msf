import { describe, expect, it } from "vitest";
import { validateAllSetupSteps, validateSetupStep, type SetupValidationValues } from "@/pages/setup/setup-validation";

const validForm: SetupValidationValues = {
  username: "root",
  password: "p",
  confirmPassword: "p",
  email: "",
  webPort: "7788",
  selected_interface: "eth0",
  mosdnsEnabled: true,
  proxyCore: "mihomo",
};

describe("setup step validation", () => {
  it("keeps optional fields optional and accepts a short non-empty password", () => {
    expect(validateAllSetupSteps(validForm)).toEqual([]);
  });

  it("validates only the current step", () => {
    const form = { ...validForm, selected_interface: "", proxyCore: "none" };
    expect(validateSetupStep(0, form)).toEqual([]);
    expect(validateSetupStep(1, form).map((issue) => issue.field)).toEqual(["selected_interface"]);
    expect(validateSetupStep(2, form).map((issue) => issue.field)).toEqual(["proxyCore"]);
  });

  it("checks account consistency without imposing composition rules", () => {
    const fields = validateSetupStep(0, {
      ...validForm,
      username: "",
      password: "one",
      confirmPassword: "two",
      email: "invalid",
      webPort: "70000",
    }).map((issue) => issue.field);
    expect(fields).toEqual(["username", "confirmPassword", "email", "webPort"]);
  });
});
