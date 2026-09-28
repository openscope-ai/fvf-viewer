import { readFileSync } from "node:fs";
import path from "node:path";
import { buildServer } from "./server";

const port = Number(process.env["PORT"] ?? 3000);
const staticRoot =
  process.env["FVF_STATIC_ROOT"] ?? path.resolve(__dirname, "../../web/dist");
const version = (
  JSON.parse(
    readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
  ) as { version: string }
).version;

async function main(): Promise<void> {
  const app = await buildServer({
    version,
    staticRoot,
  });

  try {
    const address = await app.listen({ port, host: "0.0.0.0" });
    app.log.info(
      `fvf-viewer server listening at ${address} (static root: ${staticRoot})`,
    );
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
