import "dotenv/config";
import { z } from "zod";
import { zPrivateKey } from "./shared/utils";

/**
 * Parse env variables in a typesafe way.
 */
const EnvConfigSchema = z.object({
  DEPLOYER_PRIVATE_KEY: zPrivateKey().default(
    // random key
    "0x845074c29c6487a92fa902e06" + "f1a1fe1ac0eb801fd6624b0a486e3c04a75721f",
  ),
});

let envConfig: z.infer<typeof EnvConfigSchema>;
try {
  envConfig = EnvConfigSchema.parse(process.env);
} catch (e: any) {
  throw new Error(
    `Error parsing .env file: ${e.errors[0].path} ${e.errors[0].message}`,
  );
}
export default envConfig;
