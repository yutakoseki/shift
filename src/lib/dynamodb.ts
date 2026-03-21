import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ShiftEntry } from "@/types/shift";
import { UserProfile, UserRole } from "@/types/user";
import { logInfo } from "@/lib/server-log";

type ShiftMonthItem = {
  monthKey: string;
  entries: ShiftEntry[];
  updatedAt: string;
};

const shiftTableName = process.env.SHIFT_TABLE_NAME;
const userTableName = process.env.USER_TABLE_NAME;
const region = process.env.AWS_REGION;

if (!shiftTableName || !userTableName || !region) {
  console.warn("SHIFT_TABLE_NAME / USER_TABLE_NAME / AWS_REGION のいずれかが未設定です。");
}

const client = new DynamoDBClient({
  region
});

const docClient = DynamoDBDocumentClient.from(client);

export async function getShiftMonth(month: string): Promise<ShiftEntry[]> {
  if (!shiftTableName) {
    throw new Error("SHIFT_TABLE_NAME is required");
  }

  const result = await docClient.send(
    new GetCommand({
      TableName: shiftTableName,
      Key: { monthKey: month }
    })
  );

  const item = result.Item as ShiftMonthItem | undefined;
  return item?.entries ?? [];
}

export async function putShiftMonth(month: string, entries: ShiftEntry[]): Promise<void> {
  if (!shiftTableName) {
    throw new Error("SHIFT_TABLE_NAME is required");
  }

  await docClient.send(
    new PutCommand({
      TableName: shiftTableName,
      Item: {
        monthKey: month,
        entries,
        updatedAt: new Date().toISOString()
      } satisfies ShiftMonthItem
    })
  );
}

export async function listUsers(): Promise<UserProfile[]> {
  if (!userTableName) {
    throw new Error("USER_TABLE_NAME is required");
  }

  const result = await docClient.send(
    new ScanCommand({
      TableName: userTableName
    })
  );

  const items = (result.Items ?? []) as UserProfile[];
  logInfo("lib/dynamodb.listUsers", "scan completed", { count: items.length, tableName: userTableName });
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getUserById(userId: string): Promise<UserProfile | null> {
  if (!userTableName) {
    throw new Error("USER_TABLE_NAME is required");
  }

  const result = await docClient.send(
    new GetCommand({
      TableName: userTableName,
      Key: { userId }
    })
  );

  const profile = (result.Item as UserProfile | undefined) ?? null;
  logInfo("lib/dynamodb.getUserById", "read completed", {
    userId,
    found: Boolean(profile),
    tableName: userTableName
  });
  return profile;
}

export async function putUserProfile(profile: Omit<UserProfile, "createdAt" | "updatedAt">): Promise<void> {
  if (!userTableName) {
    throw new Error("USER_TABLE_NAME is required");
  }

  const now = new Date().toISOString();
  await docClient.send(
    new PutCommand({
      TableName: userTableName,
      Item: {
        ...profile,
        createdAt: now,
        updatedAt: now
      } satisfies UserProfile,
      ConditionExpression: "attribute_not_exists(userId)"
    })
  );
  logInfo("lib/dynamodb.putUserProfile", "insert completed", {
    userId: profile.userId,
    role: profile.role,
    tableName: userTableName
  });
}

export async function ensureUserProfile(input: {
  userId: string;
  email: string;
  defaultRole?: UserRole;
}): Promise<UserProfile> {
  const existing = await getUserById(input.userId);
  if (existing) {
    logInfo("lib/dynamodb.ensureUserProfile", "already exists", { userId: input.userId, role: existing.role });
    return existing;
  }

  const now = new Date().toISOString();
  const role = input.defaultRole ?? "メンバー";
  const profile: UserProfile = {
    userId: input.userId,
    email: input.email,
    role,
    createdAt: now,
    updatedAt: now
  };

  if (!userTableName) {
    throw new Error("USER_TABLE_NAME is required");
  }

  await docClient.send(
    new PutCommand({
      TableName: userTableName,
      Item: profile,
      ConditionExpression: "attribute_not_exists(userId)"
    })
  );

  logInfo("lib/dynamodb.ensureUserProfile", "created", {
    userId: profile.userId,
    role: profile.role,
    tableName: userTableName
  });
  return profile;
}

export async function updateUserRole(userId: string, role: UserRole): Promise<UserProfile> {
  if (!userTableName) {
    throw new Error("USER_TABLE_NAME is required");
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: userTableName,
      Key: { userId },
      UpdateExpression: "SET #role = :role, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#role": "role"
      },
      ExpressionAttributeValues: {
        ":role": role,
        ":updatedAt": new Date().toISOString()
      },
      ConditionExpression: "attribute_exists(userId)",
      ReturnValues: "ALL_NEW"
    })
  );

  const updated = result.Attributes as UserProfile;
  logInfo("lib/dynamodb.updateUserRole", "update completed", {
    userId,
    role: updated.role,
    tableName: userTableName
  });
  return updated;
}
