import { RealClient } from "./core/RealClient";

type RealClientWithCreate = typeof RealClient & {
  create?: () => Promise<RealClient>;
};

const RealClientClass = RealClient as RealClientWithCreate;

if (typeof RealClientClass.create !== "function") {
  RealClientClass.create = async (): Promise<RealClient> => {
    const client = new RealClient();
    client.loadSession();
    return client;
  };
}
