import { test, expect, describe, mock } from "bun:test";

// Test helper functions and utilities from activities
// Note: Full activity tests would require mocking Playwright and BAML

describe("Worker Activities", () => {
  describe("URL validation helpers", () => {
    const isValidUrl = (url: string): boolean => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    };

    test("validates correct HTTP URLs", () => {
      expect(isValidUrl("https://example.com")).toBe(true);
      expect(isValidUrl("http://example.com/path")).toBe(true);
      expect(isValidUrl("https://example.com/path?query=1")).toBe(true);
    });

    test("rejects invalid URLs", () => {
      expect(isValidUrl("not-a-url")).toBe(false);
      expect(isValidUrl("")).toBe(false);
      expect(isValidUrl("ftp://example.com")).toBe(true); // FTP is valid URL
    });

    test("validates job posting URLs", () => {
      expect(isValidUrl("https://jobs.lever.co/company/12345")).toBe(true);
      expect(isValidUrl("https://boards.greenhouse.io/company/jobs/12345")).toBe(
        true
      );
      expect(isValidUrl("https://company.workday.com/job/12345")).toBe(true);
    });
  });

  describe("Content processing utilities", () => {
    const truncateContent = (content: string, maxLength: number): string => {
      if (content.length <= maxLength) return content;
      return content.slice(0, maxLength) + "...";
    };

    test("truncates long content", () => {
      const longContent = "a".repeat(1000);
      const truncated = truncateContent(longContent, 100);
      expect(truncated.length).toBe(103); // 100 + "..."
      expect(truncated.endsWith("...")).toBe(true);
    });

    test("does not truncate short content", () => {
      const shortContent = "Hello, world!";
      const result = truncateContent(shortContent, 100);
      expect(result).toBe(shortContent);
    });

    const cleanWhitespace = (text: string): string => {
      return text.replace(/\s+/g, " ").trim();
    };

    test("cleans excessive whitespace", () => {
      const messyText = "  Hello    world  \n\n  test  ";
      expect(cleanWhitespace(messyText)).toBe("Hello world test");
    });
  });

  describe("Job data normalization", () => {
    const normalizeRemoteStatus = (status: string): string => {
      const normalized = status.toLowerCase().trim();
      if (normalized.includes("remote") && normalized.includes("hybrid")) {
        return "hybrid";
      }
      if (normalized.includes("remote")) return "remote";
      if (normalized.includes("hybrid")) return "hybrid";
      if (normalized.includes("onsite") || normalized.includes("on-site")) {
        return "onsite";
      }
      return "unknown";
    };

    test("normalizes remote status variations", () => {
      expect(normalizeRemoteStatus("Remote")).toBe("remote");
      expect(normalizeRemoteStatus("REMOTE")).toBe("remote");
      expect(normalizeRemoteStatus("Hybrid")).toBe("hybrid");
      expect(normalizeRemoteStatus("On-site")).toBe("onsite");
      expect(normalizeRemoteStatus("Onsite")).toBe("onsite");
      expect(normalizeRemoteStatus("Remote/Hybrid")).toBe("hybrid");
    });

    test("handles unknown remote status", () => {
      expect(normalizeRemoteStatus("flexible")).toBe("unknown");
      expect(normalizeRemoteStatus("")).toBe("unknown");
    });
  });
});
