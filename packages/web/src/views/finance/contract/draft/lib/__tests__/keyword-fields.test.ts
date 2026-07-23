import { describe, it, expect } from "vitest";
import { isDateKey } from "../keyword-fields";

describe("isDateKey", () => {
  it("以 _date 结尾的键判为日期类", () => {
    expect(isDateKey("start_date")).toBe(true);
    expect(isDateKey("end_date")).toBe(true);
    expect(isDateKey("sign_date")).toBe(true);
    expect(isDateKey("delivery_date")).toBe(true);
  });

  it("非 _date 结尾的键不是日期类", () => {
    expect(isDateKey("amount")).toBe(false);
    expect(isDateKey("project_name")).toBe(false);
    expect(isDateKey("tax_rate")).toBe(false);
    expect(isDateKey("party_a")).toBe(false);
  });

  it("含 date 但非结尾、或空串不误判", () => {
    expect(isDateKey("date_of_signing")).toBe(false);
    expect(isDateKey("update_dated")).toBe(false);
    expect(isDateKey("")).toBe(false);
  });
});
