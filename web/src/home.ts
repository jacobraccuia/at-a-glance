const KEY = "taskr.home";

export type HomeChoice = "today" | "all";

export function readHome(): HomeChoice {
  return localStorage.getItem(KEY) === "today" ? "today" : "all";
}

export function saveHome(choice: HomeChoice) {
  localStorage.setItem(KEY, choice);
}
