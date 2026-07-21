import axios from "axios";

export const http = axios.create({
  baseURL: "https://web.realapp.com",
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    "real-version": "34",
    "real-device-type": "desktop_web",
  },
});