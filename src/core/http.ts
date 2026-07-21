import axios, { AxiosError } from "axios";

type RealApiErrorResponse = {
  statusCode?: number;
  error?: string;
  message?: string;
};

export class RealApiError extends Error {
  readonly status?: number;
  readonly method?: string;
  readonly url?: string;
  readonly responseData?: RealApiErrorResponse;

  constructor(
    message: string,
    details: {
      status?: number;
      method?: string;
      url?: string;
      responseData?: RealApiErrorResponse;
    } = {}
  ) {
    super(message);
    this.name = "RealApiError";
    this.status = details.status;
    this.method = details.method;
    this.url = details.url;
    this.responseData = details.responseData;
  }
}

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

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<RealApiErrorResponse>) => {
    const status = error.response?.status;
    const responseData = error.response?.data;
    const method = error.config?.method?.toUpperCase();
    const url = error.config?.url;

    let message =
      responseData?.message ||
      responseData?.error ||
      error.message ||
      "Real API request failed";

    if (status === 403) {
      message =
        "Real rejected the request with 403 Forbidden. Refresh REAL_SESSION_JSON and REAL_TURNSTILE_TOKEN before trying to post again.";
    }

    return Promise.reject(
      new RealApiError(message, {
        status,
        method,
        url,
        responseData,
      })
    );
  }
);
