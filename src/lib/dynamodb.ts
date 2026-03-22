import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createDefaultMasterData, MasterData, normalizeMasterData } from "@/types/master-data";
import { ShiftColumn, ShiftEntry } from "@/types/shift";
import { UserProfile, UserRole } from "@/types/user";
import { logInfo } from "@/lib/server-log";

type ShiftMonthItem = {
  monthKey: string;
  entries: ShiftEntry[];
  columns?: ShiftColumn[];
  updatedAt: string;
};

export type ShiftMonthData = {
  entries: ShiftEntry[];
  columns?: ShiftColumn[];
};

type MasterDataItem = {
  monthKey: string;
  data: MasterData;
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
const masterDataKey = "master-data-v1";

export class AwsCredentialError extends Error {
  constructor(message = "AWS credentials are invalid or expired") {
    super(message);
    this.name = "AwsCredentialError";
  }
}

function isInvalidAwsCredentialError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as { name?: string; __type?: string };
  return (
    maybeError.name === "UnrecognizedClientException" ||
    maybeError.__type === "com.amazon.coral.service#UnrecognizedClientException"
  );
}

async function sendDynamoCommand(command: unknown) {
  try {
    return await docClient.send(command as never);
  } catch (error) {
    if (isInvalidAwsCredentialError(error)) {
      throw new AwsCredentialError(
        "AWS credentials are invalid or expired. Update local credentials and retry."
      );
    }
    throw error;
  }
}

export async function getShiftMonth(month: string): Promise<ShiftMonthData> {
  if (!shiftTableName) {
    throw new Error("SHIFT_TABLE_NAME is required");
  }

  const result = (await sendDynamoCommand(
    new GetCommand({
      TableName: shiftTableName,
      Key: { monthKey: month }
    })
  )) as { Item?: ShiftMonthItem };

  const item = result.Item;
  return {
    entries: item?.entries ?? [],
    columns: item?.columns
  };
}

export async function putShiftMonth(month: string, data: ShiftMonthData): Promise<void> {
  if (!shiftTableName) {
    throw new Error("SHIFT_TABLE_NAME is required");
  }

  await sendDynamoCommand(
    new PutCommand({
      TableName: shiftTableName,
      Item: {
        monthKey: month,
        entries: data.entries,
        columns: data.columns,
        updatedAt: new Date().toISOString()
      } satisfies ShiftMonthItem
    })
  );
}

export async function getMasterData(): Promise<MasterData> {
  if (!shiftTableName) {
    throw new Error("SHIFT_TABLE_NAME is required");
  }

  const result = (await sendDynamoCommand(
    new GetCommand({
      TableName: shiftTableName,
      Key: { monthKey: masterDataKey }
    })
  )) as { Item?: MasterDataItem };

  const item = result.Item;
  if (!item?.data) {
    return createDefaultMasterData();
  }
  return normalizeMasterData(item.data);
}

export async function putMasterData(data: MasterData): Promise<void> {
  if (!shiftTableName) {
    throw new Error("SHIFT_TABLE_NAME is required");
  }

  await sendDynamoCommand(
    new PutCommand({
      TableName: shiftTableName,
      Item: {
        monthKey: masterDataKey,
        data,
        updatedAt: new Date().toISOString()
      } satisfies MasterDataItem
    })
  );
}

export async function listUsers(): Promise<UserProfile[]> {
  if (!userTableName) {
    throw new Error("USER_TABLE_NAME is required");
  }

  const result = (await sendDynamoCommand(
    new ScanCommand({
      TableName: userTableName
    })
  )) as { Items?: UserProfile[] };

  const items = result.Items ?? [];
  logInfo("lib/dynamodb.listUsers", "scan completed", { count: items.length, tableName: userTableName });
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getUserById(userId: string): Promise<UserProfile | null> {
  if (!userTableName) {
    throw new Error("USER_TABLE_NAME is required");
  }

  const result = (await sendDynamoCommand(
    new GetCommand({
      TableName: userTableName,
      Key: { userId }
    })
  )) as { Item?: UserProfile };

  const profile = result.Item ?? null;
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
  await sendDynamoCommand(
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

  await sendDynamoCommand(
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

  const result = (await sendDynamoCommand(
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
  )) as { Attributes?: UserProfile };

  const updated = result.Attributes as UserProfile;
  logInfo("lib/dynamodb.updateUserRole", "update completed", {
    userId,
    role: updated.role,
    tableName: userTableName
  });
  return updated;
}
