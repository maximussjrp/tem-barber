/**
 * Meta WhatsApp Embedded Signup Client SDK Wrapper
 * Phase R6.1B - Coexistence Embedded Signup Client Contract
 */

export const COEXISTENCE_FEATURE_TYPE = "whatsapp_business_app_onboarding";
export const COEXISTENCE_FINISH_EVENT =
  "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";

export interface LaunchEmbeddedSignupOptions {
  appId: string;
  configId: string;
  nonce?: string;
  onComplete: (data: {
    code: string;
    wabaIdHint?: string;
    phoneNumberIdHint?: string;
    metadata?: Record<string, unknown>;
  }) => void;
  onCancel?: () => void;
  onError?: (err: Error) => void;
}

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void;
      login: (
        callback: (response: {
          authResponse?: {
            code?: string;
            grantedScopes?: string;
          };
          status?: string;
        }) => void,
        options: Record<string, unknown>
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

/**
 * Loads Meta/Facebook JavaScript SDK asynchronously if not already present.
 */
export function loadFacebookSdk(appId: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }

    if (window.FB) {
      resolve();
      return;
    }

    window.fbAsyncInit = function () {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: "v21.0",
      });
      resolve();
    };

    const scriptId = "facebook-jssdk";
    if (document.getElementById(scriptId)) {
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  });
}

export const ALLOWED_SIGNUP_ORIGINS = [
  "https://www.facebook.com",
  "https://web.facebook.com",
];

/**
 * Validates whether an event origin is an authorized Meta Embedded Signup origin.
 */
export function isAllowedSignupOrigin(origin: string): boolean {
  return ALLOWED_SIGNUP_ORIGINS.includes(origin);
}

/**
 * Launches Meta Coexistence Embedded Signup window and manages message listeners.
 * Implements strict code + session event rendezvous and single-fire completion.
 */
export function launchCoexistenceEmbeddedSignup(
  options: LaunchEmbeddedSignupOptions
): () => void {
  const { configId, onComplete, onCancel, onError } = options;

  let authCode: string | null = null;
  let authGrantedScopes: string | undefined = undefined;
  let finishData: {
    wabaIdHint?: string;
    phoneNumberIdHint?: string;
    metadata?: Record<string, unknown>;
  } | null = null;
  let isSettled = false;

  const cleanup = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("message", messageHandler);
    }
  };

  const tryRendezvousComplete = () => {
    if (isSettled || !authCode || !finishData) {
      return;
    }
    isSettled = true;
    cleanup();
    onComplete({
      code: authCode,
      wabaIdHint: finishData.wabaIdHint,
      phoneNumberIdHint: finishData.phoneNumberIdHint,
      metadata: {
        ...finishData.metadata,
        grantedScopes: authGrantedScopes,
      },
    });
  };

  const safeCancel = () => {
    if (isSettled) return;
    isSettled = true;
    cleanup();
    onCancel?.();
  };

  const safeError = (err: Error) => {
    if (isSettled) return;
    isSettled = true;
    cleanup();
    onError?.(err);
  };

  const messageHandler = (event: MessageEvent) => {
    // Strict origin matching
    if (!isAllowedSignupOrigin(event.origin)) {
      return;
    }

    try {
      const data =
        typeof event.data === "string" ? JSON.parse(event.data) : event.data;

      if (data && data.type === "WA_EMBEDDED_SIGNUP") {
        if (data.event === COEXISTENCE_FINISH_EVENT) {
          const rawData = data.data || {};
          finishData = {
            wabaIdHint: rawData.waba_id ? String(rawData.waba_id) : undefined,
            phoneNumberIdHint: rawData.phone_number_id
              ? String(rawData.phone_number_id)
              : undefined,
            metadata: {
              sessionInfoVersion: data.sessionInfoVersion,
              screen: rawData.current_screen,
              event: data.event,
            },
          };
          tryRendezvousComplete();
        } else if (data.event === "CANCEL") {
          safeCancel();
        } else if (data.event === "ERROR") {
          safeError(
            new Error(
              data.data?.error_message || "Erro no Embedded Signup da Meta."
            )
          );
        }
        // Generic "FINISH" or other events are ignored under Coexistence contract
      }
    } catch {
      // Ignore non-JSON messages from other extensions or iframes
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("message", messageHandler);

    if (window.FB) {
      window.FB.login(
        (response) => {
          if (response.authResponse?.code) {
            authCode = response.authResponse.code;
            authGrantedScopes = response.authResponse.grantedScopes;
            tryRendezvousComplete();
          } else if (response.status === "unknown" || !response.authResponse) {
            safeCancel();
          } else {
            safeError(new Error("Falha ao obter código de autorização da Meta."));
          }
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: COEXISTENCE_FEATURE_TYPE,
          },
        }
      );
    } else {
      safeError(
        new Error(
          "Facebook SDK não carregado. Verifique sua conexão e tente novamente."
        )
      );
    }
  } else {
    safeError(new Error("Ambiente de navegador indisponível."));
  }

  return cleanup;
}
