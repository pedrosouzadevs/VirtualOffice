import { describe, expect, it } from "vitest";
import { format, resolveMessages } from "../src-ui/lib/i18n";

describe("resolveMessages", () => {
    it("matches an exact language tag", () => {
        expect(resolveMessages(["pt-BR"]).signOut).toBe("Sair");
        expect(resolveMessages(["en"]).signOut).toBe("Sign out");
    });

    it("falls back to the language when the region does not match", () => {
        // A browser set to pt-PT means Portuguese. Falling through to English over a region tag nobody meant to be
        // strict about would be the wrong kind of precision.
        expect(resolveMessages(["pt-PT"]).signOut).toBe("Sair");
    });

    it("honours the browser's order of preference", () => {
        expect(resolveMessages(["pt-BR", "en"]).signOut).toBe("Sair");
        expect(resolveMessages(["en-GB", "pt-BR"]).signOut).toBe("Sign out");
    });

    it("falls back to English for a language we do not have", () => {
        expect(resolveMessages(["ja"]).signOut).toBe("Sign out");
        expect(resolveMessages([]).signOut).toBe("Sign out");
    });

    it("keeps every catalogue in lockstep", () => {
        // The type already forces key parity at build time; the test is what makes the failure obvious rather than a
        // wall of TypeScript errors, and it also catches a key left blank.
        //
        // It deliberately does *not* assert that a translation differs from the English: "Tags" is the same word in
        // both languages, and a check that forbids that would only teach people to write worse Portuguese.
        const en = resolveMessages(["en"]);
        const ptBR = resolveMessages(["pt-BR"]);

        expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort());
        for (const [key, value] of Object.entries(ptBR)) {
            expect(value.trim(), `pt-BR is missing a translation for "${key}"`).not.toBe("");
        }
    });
});

describe("format", () => {
    it("substitutes placeholders", () => {
        expect(format("Revoke {tag}", { tag: "admin" })).toBe("Revoke admin");
    });

    it("leaves an unknown placeholder alone rather than printing undefined", () => {
        expect(format("Revoke {tag}", {})).toBe("Revoke {tag}");
    });

    it("substitutes every occurrence", () => {
        expect(format("{a} and {a}", { a: "x" })).toBe("x and x");
    });
});
