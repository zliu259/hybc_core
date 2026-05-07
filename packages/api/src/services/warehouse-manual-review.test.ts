import { describe, expect, it } from "vitest";

import {
  assertWarehouseManualVersionCanPublish,
  assertWarehouseManualVersionCanSubmitReview
} from "./warehouse-manual-review";

describe("warehouse manual review policy", () => {
  it("allows only draft versions to be submitted for review", () => {
    expect(() => assertWarehouseManualVersionCanSubmitReview("draft")).not.toThrow();
    expect(() => assertWarehouseManualVersionCanSubmitReview("reviewing")).toThrow(
      "manual version must be draft before review"
    );
    expect(() => assertWarehouseManualVersionCanSubmitReview("published")).toThrow(
      "manual version must be draft before review"
    );
  });

  it("allows only reviewed versions to be published", () => {
    expect(() => assertWarehouseManualVersionCanPublish("reviewing")).not.toThrow();
    expect(() => assertWarehouseManualVersionCanPublish("draft")).toThrow(
      "manual version must be reviewing before publish"
    );
    expect(() => assertWarehouseManualVersionCanPublish("archived")).toThrow(
      "manual version must be reviewing before publish"
    );
  });
});
