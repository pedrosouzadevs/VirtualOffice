import { ADMIN_API_PORT, ADMIN_API_TOKEN } from "./Enum/EnvironmentVariable";
import { createServer } from "./api/server";

const app = createServer({ adminApiToken: ADMIN_API_TOKEN });

app.listen(ADMIN_API_PORT, () => {
    console.info(`VirtualOffice admin-api listening on port ${ADMIN_API_PORT}`);
});
