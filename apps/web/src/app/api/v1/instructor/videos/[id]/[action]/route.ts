import { requireApiStaff, route, uuidParam } from "@/server/api";
import { videoAction } from "@/server/course-routes";
import { getDb } from "@/server/db";
import { ownedTarget } from "@/server/instructors";

// I-04 영상 작업: complete · retranscode · subtitles · playback (자기 과정의 영상만)
export const POST = route<{ params: Promise<{ id: string; action: string }> }>(
  async (request, { params }) => {
    const viewer = await requireApiStaff(request, "instructor");
    const { id: raw, action } = await params;
    const id = uuidParam(raw);
    await ownedTarget(getDb(), viewer, "video", id, { write: true });
    return videoAction(request, viewer, id, action);
  },
);
