import {
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient
} from "@aws-sdk/client-cognito-identity-provider";
import { logInfo } from "@/lib/server-log";

const region = process.env.AWS_REGION;
const userPoolId = process.env.COGNITO_USER_POOL_ID ?? process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;

if (!region || !userPoolId) {
  console.warn("AWS_REGION または COGNITO_USER_POOL_ID が未設定です。");
}

const cognitoClient = new CognitoIdentityProviderClient({ region });

export async function createCognitoUser(input: {
  email: string;
  temporaryPassword: string;
}): Promise<{ userId: string; email: string }> {
  if (!userPoolId) {
    throw new Error("COGNITO_USER_POOL_ID is required");
  }

  const email = input.email.trim();
  logInfo("lib/cognito-admin.createCognitoUser", "start", { email });
  const response = await cognitoClient.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      TemporaryPassword: input.temporaryPassword,
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" }
      ]
    })
  );

  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: email,
      Password: input.temporaryPassword,
      Permanent: true
    })
  );
  logInfo("lib/cognito-admin.createCognitoUser", "password set permanent", { email });

  const subFromCreate = response.User?.Attributes?.find((attribute) => attribute.Name === "sub")?.Value;
  logInfo("lib/cognito-admin.createCognitoUser", "sub resolution", {
    email,
    hasSubFromCreate: Boolean(subFromCreate)
  });
  const sub = subFromCreate ?? (await getUserSubByUsername(email));
  if (!sub) {
    throw new Error("Cognitoユーザー作成後にsubを取得できませんでした");
  }

  logInfo("lib/cognito-admin.createCognitoUser", "completed", { email, userId: sub });
  return { userId: sub, email };
}

async function getUserSubByUsername(username: string): Promise<string | null> {
  if (!userPoolId) {
    throw new Error("COGNITO_USER_POOL_ID is required");
  }

  const response = await cognitoClient.send(
    new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: username
    })
  );

  const sub = response.UserAttributes?.find((attribute) => attribute.Name === "sub")?.Value ?? null;
  logInfo("lib/cognito-admin.getUserSubByUsername", "resolved", {
    username,
    foundSub: Boolean(sub)
  });
  return sub;
}
