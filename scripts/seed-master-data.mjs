#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://localhost:3001";
const FALLBACK_BASE_URL = "http://localhost:3000";
const API_PATH = "/api/master-data";

function toIsoDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function createAttendance(startTime, endTime, saturdayEnabled = false) {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const isWeekday = weekday >= 1 && weekday <= 5;
    const isSaturday = weekday === 6;
    return {
      weekday,
      enabled: isWeekday || (saturdayEnabled && isSaturday),
      startTime,
      endTime
    };
  });
}

function buildShiftPatterns() {
  const defaultPatterns = [
    ["B1", "07:00", "16:00"],
    ["B2", "07:15", "16:15"],
    ["B3", "07:30", "16:30"],
    ["B4", "07:45", "16:45"],
    ["C1", "08:00", "17:00"],
    ["C2", "08:15", "17:15"],
    ["C3", "08:30", "17:30"],
    ["C4", "08:45", "17:45"],
    ["D1", "09:00", "18:00"],
    ["D2", "09:15", "18:15"],
    ["D3", "09:30", "18:30"],
    ["D4", "09:45", "18:45"]
  ].map(([code, startTime, endTime]) => ({
    code,
    label: code,
    startTime,
    endTime,
    isCustom: false
  }));

  const customPatterns = [
    { code: "E1", label: "早番補助", startTime: "10:00", endTime: "19:00", isCustom: true },
    { code: "E2", label: "早番補助2", startTime: "09:30", endTime: "18:30", isCustom: true },
    { code: "E3", label: "早番補助3", startTime: "10:30", endTime: "19:30", isCustom: true },
    { code: "S1", label: "短時間AM", startTime: "09:00", endTime: "13:00", isCustom: true },
    { code: "S2", label: "短時間PM", startTime: "14:00", endTime: "18:00", isCustom: true },
    { code: "S3", label: "短時間昼", startTime: "10:00", endTime: "14:00", isCustom: true },
    { code: "N1", label: "延長補助", startTime: "11:00", endTime: "20:00", isCustom: true },
    { code: "N2", label: "延長補助2", startTime: "12:00", endTime: "21:00", isCustom: true },
    { code: "L1", label: "行事日ロング", startTime: "08:00", endTime: "19:00", isCustom: true },
    { code: "F1", label: "フリー補助", startTime: "08:30", endTime: "16:30", isCustom: true }
  ];

  return [...defaultPatterns, ...customPatterns];
}

function buildNurseryClasses() {
  return [
    { id: "class-hiyoko", name: "ひよこ", ageGroup: "0-1歳児" },
    { id: "class-ahiru", name: "あひる", ageGroup: "0-1歳児" },
    { id: "class-usagi", name: "うさぎ", ageGroup: "2-3歳児" },
    { id: "class-kuma", name: "くま", ageGroup: "2-3歳児" },
    { id: "class-kirin", name: "きりん", ageGroup: "4-5歳児" },
    { id: "class-zou", name: "ぞう", ageGroup: "4-5歳児" }
  ];
}

function classLabel(classItem) {
  return `${classItem.name}（${classItem.ageGroup}）`;
}

function buildFullTimeStaff() {
  return [
    { id: "full-001", name: "田中 早苗", mainClass: "ひよこ,あひる", possibleShiftPatternCodes: ["B1", "B2", "C1", "F1"] },
    { id: "full-002", name: "佐藤 美咲", mainClass: "うさぎ", possibleShiftPatternCodes: ["B1", "B2", "C1", "D1"] },
    { id: "full-003", name: "鈴木 京子", mainClass: "くま", possibleShiftPatternCodes: ["B3", "C2", "D2", "E1"] },
    { id: "full-004", name: "高橋 直子", mainClass: "きりん", possibleShiftPatternCodes: ["C1", "C2", "D1", "D2"] },
    { id: "full-005", name: "伊藤 真由", mainClass: "ぞう", possibleShiftPatternCodes: ["C3", "D2", "D3", "N1"] },
    { id: "full-006", name: "渡辺 彩", mainClass: "ひよこ,うさぎ", possibleShiftPatternCodes: ["B2", "C2", "D1", "E2"] },
    { id: "full-007", name: "山本 綾", mainClass: "あひる,くま", possibleShiftPatternCodes: ["B4", "C4", "D4", "E3"] },
    { id: "full-008", name: "中村 由佳", mainClass: "きりん,ぞう", possibleShiftPatternCodes: ["B3", "C3", "D3", "N1"] },
    { id: "full-009", name: "小川 真希", mainClass: "ひよこ", possibleShiftPatternCodes: ["B1", "C1", "D1", "S3"] },
    { id: "full-010", name: "石井 玲奈", mainClass: "あひる", possibleShiftPatternCodes: ["B2", "C2", "D2", "E2"] },
    { id: "full-011", name: "林 由美", mainClass: "うさぎ,くま", possibleShiftPatternCodes: ["B3", "C3", "D3", "F1"] },
    { id: "full-012", name: "井口 美帆", mainClass: "きりん", possibleShiftPatternCodes: ["C2", "D2", "E3", "L1"] },
    { id: "full-013", name: "三浦 佳奈", mainClass: "ぞう", possibleShiftPatternCodes: ["C4", "D4", "N1", "N2"] }
  ];
}

function buildPartTimeStaff() {
  return [
    {
      id: "part-001",
      name: "加藤 朋子",
      mainClass: "ひよこ",
      availableWeekdays: [1, 2, 3, 4, 5],
      availableStartTime: "08:30",
      availableEndTime: "14:30",
      possibleShiftPatternCodes: ["S1", "C1"],
      defaultShiftPatternCode: "S1",
      weeklyDays: 5,
      notes: "午前メイン"
    },
    {
      id: "part-002",
      name: "小林 恵",
      mainClass: "あひる,うさぎ",
      availableWeekdays: [1, 3, 5],
      availableStartTime: "09:00",
      availableEndTime: "16:00",
      possibleShiftPatternCodes: ["C1", "C2", "S1"],
      defaultShiftPatternCode: "C1",
      weeklyDays: 3,
      notes: "扶養内"
    },
    {
      id: "part-003",
      name: "吉田 真理",
      mainClass: "くま",
      availableWeekdays: [2, 3, 4, 5, 6],
      availableStartTime: "13:00",
      availableEndTime: "19:00",
      possibleShiftPatternCodes: ["S2", "D1", "E1"],
      defaultShiftPatternCode: "S2",
      weeklyDays: 4,
      notes: "夕方帯対応"
    },
    {
      id: "part-004",
      name: "山田 葵",
      mainClass: "きりん",
      availableWeekdays: [1, 2, 4],
      availableStartTime: "10:00",
      availableEndTime: "18:00",
      possibleShiftPatternCodes: ["E1", "D2", "D3"],
      defaultShiftPatternCode: "E1",
      weeklyDays: 3,
      notes: "行事日は延長可"
    },
    {
      id: "part-005",
      name: "斎藤 亜紀",
      mainClass: "ぞう",
      availableWeekdays: [1, 2, 3, 4, 5],
      availableStartTime: "11:00",
      availableEndTime: "20:00",
      possibleShiftPatternCodes: ["N1", "D3", "D4"],
      defaultShiftPatternCode: "N1",
      weeklyDays: 5,
      notes: "延長保育担当"
    },
    {
      id: "part-006",
      name: "松本 未来",
      mainClass: "うさぎ,くま",
      availableWeekdays: [1, 2, 3, 4, 5],
      availableStartTime: "09:30",
      availableEndTime: "15:30",
      possibleShiftPatternCodes: ["C2", "S1", "S2"],
      defaultShiftPatternCode: "C2",
      weeklyDays: 4,
      notes: "制作補助"
    }
  ];
}

function buildChildren(classes) {
  const now = new Date();
  const year = now.getFullYear();
  const byId = Object.fromEntries(classes.map((item) => [item.id, item]));

  const rows = [
    ["child-001", "青木 はる", year - 1, 6, 12, "class-hiyoko", "08:00", "17:00", false],
    ["child-002", "井上 みお", year - 1, 3, 7, "class-hiyoko", "08:30", "17:30", false],
    ["child-003", "岡田 そうた", year - 1, 1, 21, "class-ahiru", "09:00", "18:00", true],
    ["child-004", "木村 りこ", year - 1, 10, 2, "class-ahiru", "08:15", "17:15", false],
    ["child-005", "近藤 ひなた", year - 3, 5, 19, "class-usagi", "08:30", "17:30", false],
    ["child-006", "清水 けんと", year - 3, 8, 9, "class-usagi", "09:00", "18:00", false],
    ["child-007", "田村 えま", year - 2, 12, 25, "class-kuma", "08:00", "17:00", false],
    ["child-008", "永井 とうま", year - 3, 2, 14, "class-kuma", "08:45", "17:45", true],
    ["child-009", "西田 こと", year - 5, 4, 1, "class-kirin", "09:00", "18:00", false],
    ["child-010", "野村 みな", year - 4, 7, 18, "class-kirin", "08:30", "17:30", false],
    ["child-011", "橋本 たいが", year - 5, 9, 5, "class-zou", "09:00", "18:30", true],
    ["child-012", "藤本 ゆな", year - 4, 11, 27, "class-zou", "08:15", "17:15", false],
    ["child-013", "前田 さな", year - 1, 7, 4, "class-hiyoko", "08:00", "16:30", false],
    ["child-014", "村上 はるき", year - 2, 1, 29, "class-ahiru", "08:30", "17:00", false],
    ["child-015", "森 かな", year - 2, 6, 11, "class-usagi", "09:00", "17:30", false],
    ["child-016", "山下 れお", year - 3, 3, 16, "class-kuma", "08:45", "18:00", true],
    ["child-017", "山口 しおり", year - 4, 12, 8, "class-kirin", "09:00", "18:00", false],
    ["child-018", "吉川 そう", year - 5, 2, 3, "class-zou", "08:30", "17:45", false],
    ["child-019", "安藤 ひなの", year - 1, 4, 15, "class-hiyoko", "08:30", "17:00", false],
    ["child-020", "石田 たくみ", year - 1, 9, 30, "class-hiyoko", "09:00", "18:00", true],
    ["child-021", "上田 こはる", year - 1, 2, 10, "class-ahiru", "08:15", "17:15", false],
    ["child-022", "遠藤 そうすけ", year - 1, 11, 6, "class-ahiru", "08:45", "17:45", false],
    ["child-023", "大西 ゆい", year - 3, 1, 18, "class-usagi", "08:30", "17:30", false],
    ["child-024", "柏木 りつ", year - 2, 8, 22, "class-usagi", "09:00", "18:00", true],
    ["child-025", "川口 かんな", year - 3, 6, 5, "class-kuma", "08:00", "17:00", false],
    ["child-026", "工藤 れん", year - 2, 10, 13, "class-kuma", "08:45", "18:00", false],
    ["child-027", "小松 あかり", year - 5, 1, 26, "class-kirin", "09:00", "18:00", true],
    ["child-028", "坂本 はやと", year - 4, 4, 8, "class-kirin", "08:30", "17:30", false],
    ["child-029", "塩谷 みづき", year - 5, 7, 1, "class-zou", "09:00", "18:15", false],
    ["child-030", "島田 こうせい", year - 4, 3, 19, "class-zou", "08:15", "17:15", true],
    ["child-031", "杉本 ひかる", year - 1, 5, 27, "class-hiyoko", "08:00", "16:30", false],
    ["child-032", "関 ゆうな", year - 1, 12, 2, "class-ahiru", "08:30", "17:00", false],
    ["child-033", "高木 たくと", year - 3, 9, 14, "class-usagi", "09:00", "17:30", false],
    ["child-034", "竹内 りお", year - 2, 2, 24, "class-kuma", "08:45", "18:00", true],
    ["child-035", "中尾 さくら", year - 4, 6, 29, "class-kirin", "09:00", "18:00", false],
    ["child-036", "長谷川 いつき", year - 5, 11, 11, "class-zou", "08:30", "17:45", false]
  ];

  return rows.map(([id, name, y, m, d, classId, startTime, endTime, saturdayEnabled]) => {
    const classItem = byId[classId];
    return {
      id,
      name,
      birthDate: toIsoDate(y, m, d),
      classId,
      className: classLabel(classItem),
      attendanceByWeekday: createAttendance(startTime, endTime, saturdayEnabled)
    };
  });
}

function buildShiftRules() {
  return {
    saturdayRequirement: {
      enabled: true,
      minTotalStaff: 3,
      combinations: [
        { partTimeCount: 2, fullTimeCount: 1 },
        { partTimeCount: 1, fullTimeCount: 2 },
        { partTimeCount: 0, fullTimeCount: 3 }
      ]
    },
    compensatoryHoliday: {
      enabled: true,
      sameWeekRequired: true,
      description: "土曜日に出勤した職員は、原則として同じ週に振替休日を取得する。"
    },
    creationOrder: [
      { id: "step-1", order: 1, title: "休みを入力" },
      { id: "step-2", order: 2, title: "イベントを入力" },
      { id: "step-3", order: 3, title: "パートさんでほぼ入れる人を入れる" },
      { id: "step-4", order: 4, title: "常勤の早番を入れる" },
      { id: "step-5", order: 5, title: "常勤の遅番を入れる" },
      { id: "step-6", order: 6, title: "週◯回のパートさんを入れる" },
      { id: "step-7", order: 7, title: "常勤で調整する" }
    ],
    autoGenerationPolicy: {
      useProgrammaticLogic: true,
      useAi: true,
      skipSundayProcessing: true,
      preventFixedFullTimeShift: true,
      description: "シフト自動作成は、ルールベースのプログラムとAI補助を組み合わせて実行する。"
    }
  };
}

function parseArgs(argv) {
  const args = { baseUrl: "", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if ((token === "--base-url" || token === "-u") && argv[i + 1]) {
      args.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
  }
  return args;
}

function buildEndpoint(baseUrl) {
  return `${baseUrl.replace(/\/$/, "")}${API_PATH}`;
}

async function endpointReachable(endpoint) {
  try {
    const response = await fetch(endpoint);
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveEndpoint(baseUrlArg) {
  if (baseUrlArg) {
    return buildEndpoint(baseUrlArg);
  }

  const primaryEndpoint = buildEndpoint(DEFAULT_BASE_URL);
  if (await endpointReachable(primaryEndpoint)) {
    return primaryEndpoint;
  }

  const fallbackEndpoint = buildEndpoint(FALLBACK_BASE_URL);
  if (await endpointReachable(fallbackEndpoint)) {
    return fallbackEndpoint;
  }

  return primaryEndpoint;
}

async function main() {
  const { baseUrl, dryRun } = parseArgs(process.argv.slice(2));
  const endpoint = await resolveEndpoint(baseUrl);

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`GET ${endpoint} failed: ${response.status}`);
  }
  const currentData = await response.json();

  const nurseryClasses = buildNurseryClasses();
  const shiftPatterns = buildShiftPatterns();
  const fullTimeStaff = buildFullTimeStaff();
  const partTimeStaff = buildPartTimeStaff();
  const children = buildChildren(nurseryClasses);
  const shiftRules = buildShiftRules();

  const nextData = {
    ...currentData,
    nurseryClasses,
    shiftPatterns,
    fullTimeStaff,
    partTimeStaff,
    children,
    shiftRules,
    updatedAt: new Date().toISOString()
  };

  if (dryRun) {
    const summary = {
      endpoint,
      fullTimeStaff: nextData.fullTimeStaff.length,
      partTimeStaff: nextData.partTimeStaff.length,
      children: nextData.children.length,
      nurseryClasses: nextData.nurseryClasses.length,
      shiftPatterns: nextData.shiftPatterns.length,
      customShiftPatterns: nextData.shiftPatterns.filter((item) => item.isCustom).length
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const putResponse = await fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nextData)
  });

  if (!putResponse.ok) {
    const errorBody = await putResponse.text();
    throw new Error(`PUT ${endpoint} failed: ${putResponse.status} ${errorBody}`);
  }

  console.log("Dummy master data has been seeded.");
  console.log(`Endpoint: ${endpoint}`);
  console.log(`常勤の先生: ${fullTimeStaff.length}件`);
  console.log(`パートの先生: ${partTimeStaff.length}件`);
  console.log(`園児: ${children.length}件`);
  console.log(`クラス: ${nurseryClasses.length}件`);
  console.log(`シフトパターン(カスタム含む): ${shiftPatterns.length}件`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
