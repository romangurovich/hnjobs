import { test, expect, describe } from "bun:test";
import { jobInputSchema, type JobInput } from "../src/index";

describe("jobInputSchema", () => {
  test("validates a complete job input", () => {
    const validJob: JobInput = {
      company_name: "Acme Corp",
      job_title: "Senior Engineer",
      salary_min: 100000,
      salary_max: 150000,
      salary_currency: "USD",
      location: "San Francisco, CA",
      remote_status: "hybrid",
      role_level: "senior",
      management_level: 0,
      technologies: ["TypeScript", "React", "Node.js"],
      processed_from: "LINK",
    };

    const result = jobInputSchema.safeParse(validJob);
    expect(result.success).toBe(true);
  });

  test("validates job with null salary fields", () => {
    const jobWithNullSalary: JobInput = {
      company_name: "Startup Inc",
      job_title: "Full Stack Developer",
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      location: "Remote",
      remote_status: "remote",
      role_level: "mid",
      management_level: 3,
      technologies: ["Python", "Django"],
      processed_from: "POST_CONTENT",
    };

    const result = jobInputSchema.safeParse(jobWithNullSalary);
    expect(result.success).toBe(true);
  });

  test("rejects invalid management_level", () => {
    const invalidJob = {
      company_name: "Test Co",
      job_title: "Manager",
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      location: "NYC",
      remote_status: "onsite",
      role_level: "lead",
      management_level: 15, // Invalid: must be 0-10
      technologies: [],
      processed_from: "LINK",
    };

    const result = jobInputSchema.safeParse(invalidJob);
    expect(result.success).toBe(false);
  });

  test("rejects missing required fields", () => {
    const incompleteJob = {
      company_name: "Test Co",
      // Missing other required fields
    };

    const result = jobInputSchema.safeParse(incompleteJob);
    expect(result.success).toBe(false);
  });

  test("rejects invalid processed_from value", () => {
    const invalidProcessedFrom = {
      company_name: "Test Co",
      job_title: "Developer",
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      location: "Remote",
      remote_status: "remote",
      role_level: "junior",
      management_level: 0,
      technologies: [],
      processed_from: "INVALID_VALUE",
    };

    const result = jobInputSchema.safeParse(invalidProcessedFrom);
    expect(result.success).toBe(false);
  });
});
