import { afterEach, describe, expect, it } from "vitest";
import {
    closeStartedServers,
    serveTestApp,
    StubAuditLogRepository,
    StubReportRepository,
    TEST_ADMIN_API_TOKEN,
} from "./helpers/testApp";

const postAuth = {
    method: "POST",
    headers: { Authorization: TEST_ADMIN_API_TOKEN, "Content-Type": "application/json" },
};

/** The body `AdminApi.reportPlayer` sends, field for field. Note `roomUrl` renamed to `reportWorldSlug`. */
const reportBody = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
        reportedUserUuid: "troublemaker@example.com",
        reportedUserComment: "Kept shouting in the meeting room",
        reporterUserUuid: "alice@example.com",
        reportWorldSlug: "http://play.workadventure.localhost/~/maps/office.wam",
        ...overrides,
    });

afterEach(closeStartedServers);

describe("POST /api/report", () => {
    it("requires the admin token", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: reportBody(),
        });

        expect(response.status).toBe(403);
    });

    it("accepts a JSON body carrying reportWorldSlug, not a query string", async () => {
        // The pusher's own OpenAPI comment declares these `in: "query"` and calls the room `roomUrl`; the code posts a
        // body and renames it (ADR-0005, correction #3). Reading the documented shape stores four empty strings.
        const reports = new StubReportRepository();
        const url = await serveTestApp({ reportRepository: reports });

        const response = await fetch(`${url}/api/report`, { ...postAuth, body: reportBody() });

        expect(response.status).toBe(200);
        expect(reports.reports).toMatchObject([
            {
                reportedIdentifier: "troublemaker@example.com",
                reporterIdentifier: "alice@example.com",
                comment: "Kept shouting in the meeting room",
                roomUrl: "http://play.workadventure.localhost/~/maps/office.wam",
            },
        ]);
    });

    it("ignores the same fields sent as a query string", async () => {
        // The other half of the correction: an implementation that read the query would appear to work against the
        // documentation and store nothing against the real caller.
        const reports = new StubReportRepository();
        const url = await serveTestApp({ reportRepository: reports });

        const response = await fetch(
            `${url}/api/report?reportedUserUuid=someone@example.com&reportedUserComment=from-the-query`,
            { ...postAuth, body: reportBody() },
        );

        expect(response.status).toBe(200);
        expect(reports.reports[0]?.comment).toBe("Kept shouting in the meeting room");
    });

    it("normalises both identifiers, so every report about one person is found by one query", async () => {
        const reports = new StubReportRepository();
        const url = await serveTestApp({ reportRepository: reports });

        await fetch(`${url}/api/report`, {
            ...postAuth,
            body: reportBody({ reportedUserUuid: "Trouble.Maker@Example.COM", reporterUserUuid: "Alice@Example.COM" }),
        });

        expect(reports.reports[0]).toMatchObject({
            reportedIdentifier: "trouble.maker@example.com",
            reporterIdentifier: "alice@example.com",
        });
    });

    it("keeps the comment verbatim, however long", async () => {
        const reports = new StubReportRepository();
        const url = await serveTestApp({ reportRepository: reports });
        const comment = "They ".repeat(500).trim();

        await fetch(`${url}/api/report`, { ...postAuth, body: reportBody({ reportedUserComment: comment }) });

        expect(reports.reports[0]?.comment).toBe(comment);
    });

    it("stores a report from an anonymous visitor, who carries a uuid rather than an email", async () => {
        const reports = new StubReportRepository();
        const url = await serveTestApp({ reportRepository: reports });

        await fetch(`${url}/api/report`, {
            ...postAuth,
            body: reportBody({ reporterUserUuid: "998ce839-3dea-4698-8b41-ebbdf7688ad9" }),
        });

        expect(reports.reports[0]?.reporterIdentifier).toBe("998ce839-3dea-4698-8b41-ebbdf7688ad9");
    });

    it("stores a report carrying nothing but who was reported", async () => {
        // Everything else has a safe default on purpose: the pusher swallows a failure here into Sentry and the
        // report is lost. Thin evidence beats none.
        const reports = new StubReportRepository();
        const url = await serveTestApp({ reportRepository: reports });

        const response = await fetch(`${url}/api/report`, {
            ...postAuth,
            body: JSON.stringify({ reportedUserUuid: "troublemaker@example.com" }),
        });

        expect(response.status).toBe(200);
        expect(reports.reports).toMatchObject([{ comment: "", reporterIdentifier: "", roomUrl: "" }]);
    });

    it("refuses a request naming nobody", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/report`, {
            ...postAuth,
            body: JSON.stringify({ reportedUserComment: "Something happened" }),
        });

        expect(response.status).toBe(400);
    });

    it("is the record itself, and writes nothing to the audit log", async () => {
        // The audit log answers "which administrator changed what". A report is neither an administrator nor a change,
        // and mixing the two would make the permission history unreadable. The report table is the record
        // (ADR-0005, decision #4) — and in P3 it notifies nobody, deliberately.
        const reports = new StubReportRepository();
        const audit = new StubAuditLogRepository();
        const url = await serveTestApp({ reportRepository: reports, auditLog: audit });

        await fetch(`${url}/api/report`, { ...postAuth, body: reportBody() });

        expect(reports.reports).toHaveLength(1);
        expect(audit.entries).toHaveLength(0);
    });
});
