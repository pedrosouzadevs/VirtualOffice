import { ADMIN_API_DATABASE_URL } from "../Enum/EnvironmentVariable";
import { createDatabaseConnection } from "../Infrastructure/Database/connection";
import { DrizzleAuditLogRepository } from "../Infrastructure/Repositories/DrizzleAuditLogRepository";
import { DrizzleMemberRepository } from "../Infrastructure/Repositories/DrizzleMemberRepository";
import { DrizzleTagRepository } from "../Infrastructure/Repositories/DrizzleTagRepository";
import { grantTag, listAudit, listMembers, listTags, revokeTag, setMemberName, type CommandContext } from "./commands";

const USAGE = `Manage Admin API members and tags.

  npm run member:list
  npm run member:grant     -- <email> <tag>
  npm run member:revoke    -- <email> <tag>
  npm run member:set-name  -- <email> <name>
  npm run tag:list
  npm run audit:list       -- [email]

Every command is idempotent: running it twice changes nothing the second time.

Changes made here are recorded in the audit log as "cli": a command run inside the container has no logged-in
identity, so the entry says somebody with shell access did it rather than naming a person.`;

/**
 * Entry point for the management commands (ADR-0003, decision #3).
 *
 * A CLI rather than an HTTP API on purpose: the only consumer of such an API would be the P2 dashboard, and shipping
 * it now would mean protecting a privilege-granting endpoint with the token already shared with the pusher. This runs
 * inside the container with the service's own database credentials and adds no network surface.
 */
async function main(): Promise<number> {
    const [command, ...args] = process.argv.slice(2);

    if (command === undefined || command === "--help" || command === "-h") {
        console.info(USAGE);
        return command === undefined ? 1 : 0;
    }

    // Only one connection: these commands run one statement or two, then exit.
    const connection = createDatabaseConnection(ADMIN_API_DATABASE_URL, 1);
    const context: CommandContext = {
        members: new DrizzleMemberRepository(connection.db),
        tags: new DrizzleTagRepository(connection.db),
        audit: new DrizzleAuditLogRepository(connection.db),
        out: (line) => console.info(line),
    };

    try {
        switch (command) {
            case "member:list":
                return (await listMembers(context)).exitCode;
            case "tag:list":
                return (await listTags(context)).exitCode;
            case "audit:list":
                return (await listAudit(context, args[0])).exitCode;
            case "member:grant":
                return (await grantTag(context, args[0] ?? "", args[1] ?? "")).exitCode;
            case "member:revoke":
                return (await revokeTag(context, args[0] ?? "", args[1] ?? "")).exitCode;
            case "member:set-name":
                // The rest of argv is the name, so it may contain spaces without needing quotes.
                return (await setMemberName(context, args[0] ?? "", args.slice(1).join(" "))).exitCode;
            default:
                console.error(`Unknown command "${command}".\n`);
                console.info(USAGE);
                return 1;
        }
    } finally {
        await connection.close();
    }
}

main()
    .then((exitCode) => {
        process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
        // Connection refused, missing tables, bad credentials: the environment is wrong, not the request.
        console.error("Command failed.", error);
        process.exit(2);
    });
