import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ShiftEntry } from "@/types/shift";

type ShiftMonthItem = {
  monthKey: string;
  entries: ShiftEntry[];
  updatedAt: string;
};

const tableName = process.env.SHIFT_TABLE_NAME;
const region = process.env.AWS_REGION;

if (!tableName || !region) {
  console.warn("SHIFT_TABLE_NAME または AWS_REGION が未設定です。");
}

const client = new DynamoDBClient({
  region
});

const docClient = DynamoDBDocumentClient.from(client);

export async function getShiftMonth(month: string): Promise<ShiftEntry[]> {
  if (!tableName) {
    throw new Error("SHIFT_TABLE_NAME is required");
  }

  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { monthKey: month }
    })
  );

  const item = result.Item as ShiftMonthItem | undefined;
  return item?.entries ?? [];
}

export async function putShiftMonth(month: string, entries: ShiftEntry[]): Promise<void> {
  if (!tableName) {
    throw new Error("SHIFT_TABLE_NAME is required");
  }

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        monthKey: month,
        entries,
        updatedAt: new Date().toISOString()
      } satisfies ShiftMonthItem
    })
  );
}
