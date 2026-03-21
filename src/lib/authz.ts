import { getUserById } from "@/lib/dynamodb";

export async function assertAdminByActorHeader(actorUserId: string | null): Promise<void> {
  if (!actorUserId) {
    throw new Error("actorUserId is required");
  }

  const actor = await getUserById(actorUserId);
  if (!actor) {
    throw new Error("actor is not registered");
  }
  if (actor.role !== "管理者") {
    throw new Error("forbidden");
  }
}
