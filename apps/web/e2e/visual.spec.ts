import { expect, test } from "@playwright/test";
import { mockStudioApi } from "./mockApi";

async function preparePage(page: Parameters<typeof test>[0]["page"]) {
  await page.addStyleTag({
    content: `
      * {
        animation-duration: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    `
  });
}

test.describe("visual smoke", () => {
  test("home page", async ({ page }) => {
    await mockStudioApi(page);
    await page.goto("/#/");
    await page.waitForLoadState("networkidle");
    await preparePage(page);
    await expect(page.locator("main.content")).toHaveScreenshot("home-page.png", { animations: "disabled" });
  });

  test("viewer page", async ({ page }) => {
    await mockStudioApi(page);
    await page.goto("/#/viewer");
    await page.waitForLoadState("networkidle");
    await preparePage(page);
    await expect(page.locator("main.content")).toHaveScreenshot("viewer-page.png", { animations: "disabled" });
  });

  test("help page", async ({ page }) => {
    await mockStudioApi(page);
    await page.goto("/#/help");
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: "Platform Manual" }).waitFor();
    await preparePage(page);
    await expect(page.locator("main.content")).toHaveScreenshot("help-page.png", { animations: "disabled" });
  });

  test("report page", async ({ page }) => {
    await mockStudioApi(page);
    await page.goto("/#/report/report-project-portfolio");
    await page.waitForLoadState("networkidle");
    await page.locator("text=Project Portfolio").first().waitFor();
    await preparePage(page);
    await expect(page.locator("main.content")).toHaveScreenshot("report-page.png", { animations: "disabled" });
  });

  test("dashboard page", async ({ page }) => {
    await mockStudioApi(page);
    await page.goto("/#/dashboard/dashboard-executive-pulse");
    await page.getByRole("heading", { name: "Executive Pulse" }).waitFor();
    await page.locator(".dashboard-tabs").waitFor();
    await preparePage(page);
    await expect(page.locator("main.content")).toHaveScreenshot("dashboard-page.png", { animations: "disabled" });
  });

  test("studio dashboard editor", async ({ page }) => {
    await mockStudioApi(page);
    await page.goto("/#/studio/dashboard-executive-pulse");
    await page.getByText("Dashboard Preview").waitFor();
    await page.getByText("Selected row").waitFor();
    await preparePage(page);
    await expect(page.locator("main.content")).toHaveScreenshot("studio-dashboard-page.png", { animations: "disabled" });
  });

  test("expired session gate", async ({ page }) => {
    await mockStudioApi(page, { expiredSession: true });
    await page.goto("/#/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: "Session expired" }).waitFor();
    await preparePage(page);
    await expect(page.locator("main.content")).toHaveScreenshot("session-expired.png", { animations: "disabled" });
  });
});
