import { ADMIN_API_PORT } from "./Enum/EnvironmentVariable";
import { createServer } from "./api/server";

const app = createServer();

app.listen(ADMIN_API_PORT, () => {
    console.info(`VirtualOffice admin-api listening on port ${ADMIN_API_PORT}`);
});
