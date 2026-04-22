# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps/web/e2e/visual.spec.ts >> visual smoke >> studio dashboard editor
- Location: apps/web/e2e/visual.spec.ts:51:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/#/studio/dashboard-executive-pulse", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { mockStudioApi } from "./mockApi";
  3  | 
  4  | async function preparePage(page: Parameters<typeof test>[0]["page"]) {
  5  |   await page.addStyleTag({
  6  |     content: `
  7  |       * {
  8  |         animation-duration: 0s !important;
  9  |         transition-duration: 0s !important;
  10 |         caret-color: transparent !important;
  11 |       }
  12 |     `
  13 |   });
  14 | }
  15 | 
  16 | test.describe("visual smoke", () => {
  17 |   test("home page", async ({ page }) => {
  18 |     await mockStudioApi(page);
  19 |     await page.goto("/#/");
  20 |     await page.waitForLoadState("networkidle");
  21 |     await preparePage(page);
  22 |     await expect(page.locator("main.content")).toHaveScreenshot("home-page.png", { animations: "disabled" });
  23 |   });
  24 | 
  25 |   test("viewer page", async ({ page }) => {
  26 |     await mockStudioApi(page);
  27 |     await page.goto("/#/viewer");
  28 |     await page.waitForLoadState("networkidle");
  29 |     await preparePage(page);
  30 |     await expect(page.locator("main.content")).toHaveScreenshot("viewer-page.png", { animations: "disabled" });
  31 |   });
  32 | 
  33 |   test("report page", async ({ page }) => {
  34 |     await mockStudioApi(page);
  35 |     await page.goto("/#/report/report-project-portfolio");
  36 |     await page.waitForLoadState("networkidle");
  37 |     await page.locator("text=Project Portfolio").first().waitFor();
  38 |     await preparePage(page);
  39 |     await expect(page.locator("main.content")).toHaveScreenshot("report-page.png", { animations: "disabled" });
  40 |   });
  41 | 
  42 |   test("dashboard page", async ({ page }) => {
  43 |     await mockStudioApi(page);
  44 |     await page.goto("/#/dashboard/dashboard-executive-pulse");
  45 |     await page.getByRole("heading", { name: "Executive Pulse" }).waitFor();
  46 |     await page.locator(".dashboard-tabs").waitFor();
  47 |     await preparePage(page);
  48 |     await expect(page.locator("main.content")).toHaveScreenshot("dashboard-page.png", { animations: "disabled" });
  49 |   });
  50 | 
  51 |   test("studio dashboard editor", async ({ page }) => {
  52 |     await mockStudioApi(page);
> 53 |     await page.goto("/#/studio/dashboard-executive-pulse");
     |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  54 |     await page.getByText("Dashboard Preview").waitFor();
  55 |     await page.getByText("Selected row").waitFor();
  56 |     await preparePage(page);
  57 |     await expect(page.locator("main.content")).toHaveScreenshot("studio-dashboard-page.png", { animations: "disabled" });
  58 |   });
  59 | 
  60 |   test("expired session gate", async ({ page }) => {
  61 |     await mockStudioApi(page, { expiredSession: true });
  62 |     await page.goto("/#/");
  63 |     await page.waitForLoadState("networkidle");
  64 |     await page.getByRole("heading", { name: "Session expired" }).waitFor();
  65 |     await preparePage(page);
  66 |     await expect(page.locator("main.content")).toHaveScreenshot("session-expired.png", { animations: "disabled" });
  67 |   });
  68 | });
  69 | 
```