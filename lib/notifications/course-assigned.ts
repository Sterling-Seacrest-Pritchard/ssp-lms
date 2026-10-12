import { createNotification } from "./create";
import { sendCourseAssignedEmail, type NotifyUser, type NotifyCourse } from "@/lib/mail/notifications";

export async function notifyCourseAssigned(
  userId: string,
  user: NotifyUser,
  course: NotifyCourse & { courseId: string }
): Promise<void> {
  await createNotification({
    userId,
    type: "course_assigned",
    title: "New course assigned",
    body: course.title,
    linkHref: `/courses/${course.courseId}`,
  });
  await sendCourseAssignedEmail(user, course);
}
