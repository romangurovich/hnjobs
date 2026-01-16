import { test, expect, describe } from "bun:test";
import { z } from "zod";

// Test the input validation schemas used in the router
// Note: Full integration tests would require a D1 database mock

describe("API Router Input Schemas", () => {
  const listInputSchema = z
    .object({
      search: z.string().optional(),
      roleLevels: z.array(z.string()).optional(),
      remoteStatuses: z.array(z.string()).optional(),
      locations: z.array(z.string()).optional(),
      minSalary: z.number().nullable().optional(),
      technologies: z.array(z.string()).optional(),
      page: z.number().default(1),
      pageSize: z.number().default(10),
      sortBy: z
        .enum(["created_at", "salary_max", "company_name"])
        .default("created_at"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
    })
    .optional();

  test("list input accepts empty object", () => {
    const result = listInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.page).toBe(1);
      expect(result.data?.pageSize).toBe(10);
    }
  });

  test("list input accepts search filter", () => {
    const result = listInputSchema.safeParse({
      search: "react developer",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.search).toBe("react developer");
    }
  });

  test("list input accepts multiple filters", () => {
    const result = listInputSchema.safeParse({
      roleLevels: ["senior", "lead"],
      remoteStatuses: ["remote", "hybrid"],
      technologies: ["TypeScript", "React"],
      minSalary: 100000,
      page: 2,
      pageSize: 25,
      sortBy: "salary_max",
      sortOrder: "desc",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.roleLevels).toEqual(["senior", "lead"]);
      expect(result.data?.page).toBe(2);
      expect(result.data?.sortBy).toBe("salary_max");
    }
  });

  test("list input rejects invalid sortBy value", () => {
    const result = listInputSchema.safeParse({
      sortBy: "invalid_field",
    });
    expect(result.success).toBe(false);
  });

  test("list input rejects invalid sortOrder value", () => {
    const result = listInputSchema.safeParse({
      sortOrder: "random",
    });
    expect(result.success).toBe(false);
  });

  const checkExistingInputSchema = z.object({
    hnPostIds: z.array(z.string()),
  });

  test("checkExisting input accepts array of IDs", () => {
    const result = checkExistingInputSchema.safeParse({
      hnPostIds: ["123", "456", "789"],
    });
    expect(result.success).toBe(true);
  });

  test("checkExisting input accepts empty array", () => {
    const result = checkExistingInputSchema.safeParse({
      hnPostIds: [],
    });
    expect(result.success).toBe(true);
  });

  test("checkExisting input rejects non-string IDs", () => {
    const result = checkExistingInputSchema.safeParse({
      hnPostIds: [123, 456],
    });
    expect(result.success).toBe(false);
  });
});
