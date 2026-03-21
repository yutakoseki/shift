"use client";

import { Amplify } from "aws-amplify";

let configured = false;

export function configureAmplify(): void {
  if (configured) {
    return;
  }

  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
  const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;

  if (!userPoolId || !userPoolClientId) {
    console.warn(
      "Cognito設定が不足しています。NEXT_PUBLIC_COGNITO_USER_POOL_ID / NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID を設定してください。"
    );
    return;
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: {
          email: true
        }
      }
    }
  });

  configured = true;
}
