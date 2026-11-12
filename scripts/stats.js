export function getStudentStats(state) {
  return state.students.map((student) => {
    const entries = state.entries.filter((entry) => entry.studentId === student.id);
    return {
      ...student,
      totalPoints: student.totalPoints ?? entries.reduce((sum, entry) => sum + entry.score, 0),
      lessonCount: student.lessonCount ?? entries.filter((entry) => (entry.type || "lesson") === "lesson").length
    };
  }).sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name, "cs"));
}

export function getLevel(points) {
  if (points >= 100) return { name: "Kytarový hrdina", next: null, progress: 100 };
  if (points >= 50) return { name: "Akordový mág", next: 100, progress: ((points - 50) / 50) * 100 };
  if (points >= 20) return { name: "Rytmický objevitel", next: 50, progress: ((points - 20) / 30) * 100 };
  return { name: "První tóny", next: 20, progress: (points / 20) * 100 };
}

export function getCurrentDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
