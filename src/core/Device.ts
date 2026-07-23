import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

interface DeviceData {
  deviceUuid: string;
}

export class Device {
  private static file = path.join(process.cwd(), "bot.json");

  static getUuid(): string {
    if (fs.existsSync(this.file)) {
      const data: DeviceData = JSON.parse(
        fs.readFileSync(this.file, "utf8")
      );

      return data.deviceUuid;
    }

    const deviceUuid = randomUUID();

    fs.writeFileSync(
      this.file,
      JSON.stringify(
        {
          deviceUuid,
        },
        null,
        2
      )
    );

    return deviceUuid;
  }
}
