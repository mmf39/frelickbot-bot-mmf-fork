import { RealClient } from "./core/RealClient";

declare module "./core/RealClient" {
  namespace RealClient {
    function create(): Promise<RealClient>;
  }
}
