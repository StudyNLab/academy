import { requireApiStaff, route, uuidParam } from "@/server/api";
import { videoAction } from "@/server/course-routes";

// AD-05 영상 작업: complete(다 올림 ➔ 변환 대기열) · retranscode(다시 변환) · subtitles(srt) · playback(변환 결과 재생)
export const POST = route<{ params: Promise<{ id: string; action: string }> }>(
  async (request, { params }) => {
    const viewer = await requireApiStaff(request, "operator");
    const { id, action } = await params;
    return videoAction(request, viewer, uuidParam(id), action);
  },
);
