import { redirect } from "next/navigation";

/** Former Split tab. The combined Budget tab owns this screen. */
export default function SplitPage() {
  redirect("/budget");
}
