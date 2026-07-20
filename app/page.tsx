import type { Metadata } from "next";
import ChessGame from "./ChessGame";

export const metadata: Metadata = {
  title: "Castle — multiplayer chess",
  description: "Create a table, share the code, and play chess live with a friend.",
};

export default function Home() {
  return <ChessGame />;
}
