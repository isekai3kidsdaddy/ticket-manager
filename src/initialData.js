// 票券管家 — 初始資料
// 這個檔案放「第一次開 app + Supabase 空的」情境下的預設資料
// 朋友 / 新部署的版本要把下面兩個都改成空陣列:
//   export const KNOWN_BUYERS = [];
//   export const INITIAL_EVENTS = [];
// 一旦 Supabase 有資料,本檔案的內容就不會被讀(只當 fallback)

export const KNOWN_BUYERS = [
  "威哥","151","ABBY","JJ","關關","萬姊","萬陽","小菲","小薄荷","老墨ERIC","Jermey","工程師","黃品傑",
  "andy liu","謝佳文","toby","阿文","wendy期天","陳族元","關關朋友","Kelly","LUCY","多喊",
  "鄭宇庭chasel","網友sandy","恩媽","偉仁","米米","際暄Jimmy","叡","老黃他爸","摩爾",
  "黛西","羊叔","王者","佳文姊","吳宗桂","凱特","鄧哥","熊仔",
].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a.localeCompare(b, "zh-TW"));

export // ─── Initial data from Excel ───
const INITIAL_EVENTS = [
  { id:"e1", name:"Big bang首場", price:"預收8000", status:"active", buyers:[
    {name:"威哥",qty:10,st:"normal"},{name:"151",qty:7,st:"normal"},{name:"ABBY",qty:2,st:"normal"},{name:"JJ",qty:2,st:"normal"},
    {name:"關關",qty:2,st:"unpaid"},{name:"萬姊",qty:8,st:"normal"},{name:"小菲",qty:8,st:"normal"},
    {name:"小薄荷",qty:2,st:"normal"},{name:"老墨ERIC",qty:4,st:"normal"},{name:"Jermey",qty:4,st:"normal"},
    {name:"工程師",qty:2,st:"normal"},{name:"黃品傑",qty:2,st:"normal"}
  ]},
  { id:"e2", name:"Big bang返場", price:"預收8000", status:"active", buyers:[
    {name:"andy liu",qty:2,st:"normal"},{name:"謝佳文",qty:2,st:"normal"},{name:"toby",qty:20,st:"normal"},{name:"威哥",qty:2,st:"normal"},
    {name:"阿文",qty:6,st:"normal"},{name:"wendy期天",qty:2,st:"normal"},{name:"Jermey",qty:20,st:"normal"},
    {name:"陳族元",qty:8,st:"normal"},{name:"關關朋友",qty:4,st:"normal"},{name:"關關",qty:1,st:"unpaid"}
  ]},
  { id:"e3", name:"GD2026個人", price:"", status:"active", buyers:[
    {name:"Jermey",qty:6,st:"normal"},{name:"威哥",qty:2,st:"normal"},{name:"陳族元",qty:2,st:"normal"},
    {name:"關關朋友",qty:2,st:"normal"},{name:"關關",qty:1,st:"unpaid"}
  ]},
  { id:"e4", name:"GD見面會", price:"預收6000", status:"active", note:"多2", buyers:[
    {name:"關關",qty:6,st:"normal",note:"2人4張全勤"},{name:"威哥",qty:2,st:"normal"},{name:"工程師",qty:2,st:"normal"},
    {name:"toby",qty:4,st:"normal"},{name:"多喊",qty:2,st:"normal"},{name:"Kelly",qty:2,st:"normal"}
  ]},
  { id:"e5", name:"BTS大隊", price:"預收8000", status:"active", buyers:[
    {name:"151",qty:18,st:"normal",note:"4人全勤"},{name:"萬姊",qty:14,st:"normal"},{name:"LUCY",qty:12,st:"normal"},
    {name:"小菲",qty:4,st:"normal"},{name:"阿文",qty:6,st:"normal"},{name:"toby",qty:26,st:"normal"},{name:"關關",qty:4,st:"normal"}
  ]},
  { id:"e6", name:"BTS返場", price:"預收8000", status:"active", buyers:[
    {name:"151",qty:8,st:"normal"},{name:"小菲",qty:6,st:"normal"},{name:"toby",qty:2,st:"normal"},
    {name:"關關朋友",qty:4,st:"normal"},{name:"Jermey",qty:2,st:"normal"}
  ]},
  { id:"e7", name:"BTS田征國", price:"預收6000", status:"active", buyers:[{name:"151",qty:2,st:"normal"}]},
  { id:"e8", name:"aespa", price:"6880", status:"active", buyers:[
    {name:"小菲",qty:4,st:"normal"},{name:"151",qty:2,st:"normal"},{name:"萬姊",qty:2,st:"normal"},
    {name:"工程師",qty:4,st:"normal"},{name:"阿文",qty:2,st:"normal",note:"洋蔥"},{name:"toby",qty:4,st:"normal"}
  ]},
  { id:"e9", name:"BP大巨蛋", price:"8800", status:"active", buyers:[
    {name:"151",qty:8,st:"normal"},{name:"ABBY",qty:2,st:"normal"},{name:"工程師",qty:2,st:"normal"},{name:"小菲",qty:2,st:"normal"},
    {name:"關關",qty:1,st:"unpaid"},{name:"andy liu",qty:2,st:"normal"},{name:"toby",qty:18,st:"normal"},
    {name:"wendy期天",qty:4,st:"normal"},{name:"阿文",qty:4,st:"normal"},{name:"萬姊",qty:1,st:"normal"},
    {name:"Jermey",qty:4,st:"normal"},{name:"Kelly",qty:2,st:"normal"}
  ]},
  { id:"e10", name:"17大隊", price:"預收6000", status:"active", buyers:[
    {name:"萬姊",qty:6,st:"normal",note:"全勤"},{name:"老墨ERIC",qty:2,st:"normal"},{name:"網友sandy",qty:2,st:"normal"}
  ]},
  { id:"e11", name:"17小分隊CxM", price:"預收6000", status:"active", buyers:[
    {name:"151",qty:4,st:"normal",note:"2人全勤"},{name:"萬姊",qty:7,st:"normal",note:"2張全勤"},{name:"恩媽",qty:2,st:"normal"},
    {name:"鄭宇庭chasel",qty:2,st:"normal"},{name:"網友sandy",qty:2,st:"normal"},{name:"toby",qty:2,st:"normal"}
  ]},
  { id:"e12", name:"17小分隊 DxS", price:"預收6000", status:"active", buyers:[
    {name:"萬姊",qty:8,st:"normal",note:"6張全勤"},{name:"151",qty:4,st:"normal"}
  ]},
  { id:"e13", name:"Stray Kids", price:"預收6000", status:"active", buyers:[
    {name:"小薄荷",qty:5,st:"normal"},{name:"關關",qty:1,st:"unpaid"},{name:"關關",qty:2,st:"normal"},
    {name:"151",qty:2,st:"normal"},{name:"Jermey",qty:2,st:"normal"}
  ]},
  { id:"e14", name:"Yoasobi大巨蛋", price:"預收6000", status:"active", buyers:[{name:"阿文",qty:4,st:"normal"}]},
  { id:"e15", name:"I-dle返場", price:"預收6000", status:"active", buyers:[
    {name:"阿文",qty:4,st:"normal"},{name:"偉仁",qty:2,st:"normal"},{name:"toby",qty:2,st:"normal"}
  ]},
  { id:"e16", name:"IU", price:"預收6000", status:"active", buyers:[
    {name:"小菲",qty:4,st:"normal"},{name:"阿文",qty:2,st:"normal"},{name:"Jermey",qty:8,st:"normal"},{name:"151",qty:1,st:"normal"},
    {name:"關關",qty:3,st:"normal"},{name:"叡",qty:3,st:"normal"},{name:"陳族元",qty:2,st:"normal"},{name:"關關朋友",qty:2,st:"normal"}
  ]},
  { id:"e17", name:"劉德華", price:"7080", status:"active", buyers:[
    {name:"威哥",qty:2,st:"normal"},{name:"阿文",qty:4,st:"normal"},{name:"米米",qty:2,st:"normal"},{name:"際暄Jimmy",qty:4,st:"normal"}
  ]},
  { id:"e18", name:"New jeans", price:"預收6000", status:"active", buyers:[{name:"小菲",qty:2,st:"normal"}]},
  { id:"e19", name:"蔡依林返場", price:"7190", status:"active", buyers:[
    {name:"老墨ERIC",qty:2,st:"normal"},{name:"鄭宇庭chasel",qty:2,st:"normal"},{name:"toby",qty:6,st:"normal"},
    {name:"叡",qty:2,st:"normal"},{name:"Kelly",qty:4,st:"normal"},{name:"阿文",qty:4,st:"normal"},
    {name:"151",qty:4,st:"normal"},{name:"陳族元",qty:4,st:"normal"}
  ]},
  { id:"e20", name:"五百", price:"4200", status:"active", buyers:[
    {name:"威哥",qty:2,st:"normal"},{name:"關關",qty:2,st:"unpaid"},{name:"阿文",qty:6,st:"normal"},{name:"老黃他爸",qty:2,st:"normal"}
  ]},
  { id:"e21", name:"周杰倫首場", price:"6880", status:"active", buyers:[
    {name:"151",qty:12,st:"normal"},{name:"阿文",qty:8,st:"normal"},{name:"威哥",qty:6,st:"normal"},{name:"JJ",qty:2,st:"normal"},
    {name:"際暄Jimmy",qty:2,st:"normal"},{name:"ABBY",qty:2,st:"normal"},{name:"Jermey",qty:12,st:"normal"},{name:"叡",qty:2,st:"normal"},
    {name:"羊叔",qty:6,st:"normal"},{name:"toby",qty:8,st:"normal"},{name:"關關",qty:4,st:"normal"},{name:"Kelly",qty:8,st:"normal"},
    {name:"摩爾",qty:2,st:"normal"},{name:"偉仁",qty:2,st:"normal"},{name:"王者",qty:2,st:"normal"},{name:"黃品傑",qty:2,st:"normal"}
  ]},
  { id:"e22", name:"周杰倫返場", price:"6880", status:"active", buyers:[
    {name:"工程師",qty:2,st:"normal"},{name:"關關",qty:8,st:"normal"},{name:"toby",qty:12,st:"normal"},{name:"Kelly",qty:10,st:"normal"},
    {name:"Jermey",qty:26,st:"normal"},{name:"阿文",qty:4,st:"normal"},{name:"黛西",qty:6,st:"normal"},{name:"陳族元",qty:18,st:"normal"}
  ]},
  { id:"e23", name:"SJ大巨蛋返場", price:"6880", status:"active", buyers:[{name:"萬姊",qty:8,st:"normal",note:"6張全勤"}]},
  { id:"e24", name:"SJ D&E(台北)", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:6,st:"normal",note:"張全勤"}]},
  { id:"e25", name:"李東海", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:10,st:"normal",note:"2人4場全勤"}]},
  { id:"e26", name:"TXT", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:4,st:"normal"}]},
  { id:"e27", name:"CORTIS", price:"預收6000", status:"active", buyers:[
    {name:"萬姊",qty:4,st:"normal"},{name:"小菲",qty:4,st:"normal"},{name:"關關",qty:2,st:"unpaid"},
    {name:"工程師",qty:2,st:"normal"},{name:"wendy期天",qty:4,st:"normal"},{name:"Jermey",qty:10,st:"normal"},
    {name:"151",qty:2,st:"normal"},{name:"toby",qty:10,st:"normal"}
  ]},
  { id:"e28", name:"泰勒絲", price:"預收6000", status:"active", buyers:[
    {name:"老墨ERIC",qty:2,st:"normal"},{name:"Jermey",qty:5,st:"normal"},{name:"wendy期天",qty:3,st:"normal"},{name:"toby",qty:12,st:"normal"}
  ]},
  { id:"e29", name:"少女時代", price:"預收6000", status:"active", buyers:[{name:"工程師",qty:2,st:"normal"},{name:"Jermey",qty:2,st:"normal"}]},
  { id:"e30", name:"MAMAMOO", price:"預收6000", status:"active", buyers:[{name:"關關",qty:2,st:"unpaid"},{name:"wendy期天",qty:2,st:"normal"}]},
  { id:"e31", name:"孫燕姿", price:"6380", status:"active", buyers:[
    {name:"萬姊",qty:6,st:"normal"},{name:"摩爾",qty:2,st:"normal"},{name:"Jermey",qty:16,st:"normal"},{name:"LUCY",qty:4,st:"normal"}
  ]},
  { id:"e32", name:"寶怪 2026", price:"預收6000", status:"active", buyers:[
    {name:"阿文",qty:4,st:"normal"},{name:"toby",qty:2,st:"normal"},{name:"Jermey",qty:6,st:"normal"}
  ]},
  { id:"e33", name:"張韶涵", price:"預收6000", status:"active", buyers:[{name:"Kelly",qty:2,st:"normal"}]},
  { id:"e34", name:"SHE", price:"預收6000", status:"active", note:"多2", buyers:[
    {name:"關關",qty:6,st:"normal"},{name:"阿文",qty:6,st:"normal"},{name:"小薄荷",qty:4,st:"normal"},
    {name:"toby",qty:4,st:"normal"},{name:"叡",qty:4,st:"normal"}
  ]},
  { id:"e35", name:"TWS台北", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:2,st:"normal"}]},
  { id:"e36", name:"夏奇拉", price:"預收6000", status:"active", buyers:[{name:"Jermey",qty:2,st:"normal"}]},
  { id:"e37", name:"火星人布魯諾", price:"預收6000", status:"active", buyers:[{name:"Jermey",qty:2,st:"normal"}]},
  { id:"e38", name:"bp rose", price:"預收6000", status:"active", buyers:[{name:"151",qty:2,st:"normal"}]},
  { id:"e39", name:"JJ林俊傑", price:"預收6000", status:"active", buyers:[{name:"摩爾",qty:2,st:"normal"}]},
  { id:"e40", name:"張學友2026", price:"預收6000", status:"active", buyers:[{name:"摩爾",qty:2,st:"normal"}]},
  { id:"e41", name:"AAA2026", price:"預收6000", status:"active", buyers:[
    {name:"151",qty:4,st:"normal"},{name:"wendy期天",qty:2,st:"normal"},{name:"toby",qty:2,st:"normal"},
    {name:"偉仁",qty:2,st:"normal"},{name:"關關",qty:2,st:"unpaid"},{name:"陳族元",qty:2,st:"normal"}
  ]},
  { id:"e42", name:"Le sserafim", price:"預收6000", status:"active", buyers:[{name:"151",qty:2,st:"normal"}]},
  { id:"e43", name:"EXO台北", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:2,st:"normal"}]},
  { id:"e44", name:"濱崎步高雄", price:"預收6000", status:"active", buyers:[
    {name:"toby",qty:4,st:"normal"},{name:"阿文",qty:4,st:"normal",note:"2人2天全勤"}
  ]},
  { id:"e45", name:"TWICE安可台北", price:"預收6000", status:"active", buyers:[{name:"我",qty:4,st:"normal"}]},
  { id:"e46", name:"DAY6高雄", price:"預收6000", status:"active", buyers:[{name:"關關",qty:1,st:"normal"}]},
  { id:"e47", name:"IVE", price:"預收6000", status:"active", buyers:[{name:"151",qty:1,st:"normal"}]},
  { id:"e48", name:"馬龍", price:"預收6000", status:"active", buyers:[
    {name:"Jermey",qty:10,st:"normal"},{name:"151",qty:4,st:"normal"},{name:"小菲",qty:6,st:"normal"}
  ]},
  { id:"e49", name:"二AM", price:"預收6000", status:"active", buyers:[{name:"老墨ERIC",qty:2,st:"normal"}]},
  { id:"e50", name:"LADYGAGA", price:"預收6000", status:"active", buyers:[{name:"小薄荷",qty:4,st:"normal"}]},
  { id:"e51", name:"BP個人Jennie", price:"預收6000", status:"active", buyers:[{name:"toby",qty:2,st:"normal"}]},
  { id:"e52", name:"告五人", price:"預收6000", status:"active", buyers:[{name:"陳族元",qty:4,st:"normal"},{name:"Jermey",qty:2,st:"normal"}]},
  { id:"e53", name:"SJ83", price:"預收6000", status:"active", buyers:[{name:"關關朋友",qty:2,st:"normal"}]},
  { id:"e54", name:"SJ新小隊", price:"預收6000", status:"active", buyers:[{name:"關關朋友",qty:2,st:"normal"}]},
  { id:"e55", name:"Back number", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:2,st:"normal"}]},
  // ── Completed ──
  { id:"c1", name:"GD 返場", price:"8980", status:"done", note:"需退費 佳姐2000*2", buyers:[
    {name:"佳文姊",qty:2,st:"normal"},{name:"小菲",qty:2,st:"normal"}
  ]},
  { id:"c2", name:"蔡依林2025年底大巨蛋", price:"6990", status:"done", note:"需退費妞退1000*2 威哥退1000*2 關關先退2000*2 佳文退1000*2", buyers:[
    {name:"萬姊",qty:4,st:"normal",note:"30*2/1*2"},{name:"151",qty:2,st:"normal",note:"1/1"},{name:"威哥",qty:2,st:"normal",note:"30"},
    {name:"謝佳文",qty:2,st:"normal"},{name:"關關",qty:2,st:"normal",note:"31"},{name:"偉仁",qty:4,st:"normal",note:"31"},{name:"吳宗桂",qty:2,st:"normal",note:"31"}
  ]},
  { id:"c3", name:"SJ大隊台北六日", price:"6880", status:"done", note:"退款完成", buyers:[{name:"萬姊",qty:4,st:"normal"}]},
  { id:"c4", name:"台北五加場", price:"6880", status:"done", buyers:[{name:"工程師",qty:4,st:"normal"}]},
  { id:"c5", name:"BP高雄", price:"8800", status:"done", buyers:[{name:"萬姊",qty:2,st:"normal"}]},
  { id:"c6", name:"AAA", price:"$5980*6/$3588*4", status:"done", note:"需退費小薄荷6200", buyers:[
    {name:"151",qty:8,st:"normal"},{name:"小薄荷",qty:2,st:"normal",note:"退票"}
  ]},
  { id:"c7", name:"Babymonster大巨蛋", price:"6500", status:"done", buyers:[
    {name:"阿文",qty:2,st:"normal"},{name:"關關",qty:2,st:"normal",note:"4800"}
  ]},
  { id:"c8", name:"17小隊豪雨分隊", price:"6880", status:"done", buyers:[{name:"萬姊",qty:4,st:"normal"}]},
  { id:"c9", name:"Twice2025高雄", price:"8800", status:"done", buyers:[
    {name:"威哥",qty:1,st:"normal"},{name:"151",qty:2,st:"normal"},{name:"小薄荷",qty:2,st:"normal"},
    {name:"萬姊",qty:9,st:"normal"},{name:"凱特",qty:2,st:"normal",note:"加場"}
  ]},
  { id:"c10", name:"SJ高雄", price:"6680", status:"done", buyers:[
    {name:"工程師",qty:2,st:"normal"},{name:"威哥",qty:2,st:"normal"},{name:"老墨ERIC",qty:2,st:"normal"},{name:"toby",qty:2,st:"normal"}
  ]},
  { id:"c11", name:"金唱片", price:"8980", status:"done", buyers:[{name:"151",qty:2,st:"normal"},{name:"萬姊",qty:6,st:"normal"}]},
  { id:"c12", name:"鄧紫棋(2026/4月)", price:"6880+200理想國", status:"done",
    note:"退費 偉仁2000 KELLY2000 阿文4000 TOBY2000 小薄荷2000 1512000 LUCY2000", buyers:[
    {name:"偉仁",qty:2,st:"normal",note:"5880"},{name:"Kelly",qty:2,st:"normal",note:"5880"},
    {name:"阿文",qty:8,st:"normal",note:"6880+5880"},{name:"關關",qty:2,st:"normal",note:"6880"},
    {name:"toby",qty:2,st:"normal",note:"5880"},{name:"小薄荷",qty:2,st:"normal",note:"5880"},
    {name:"Jermey",qty:8,st:"normal",note:"6880"},{name:"151",qty:2,st:"normal",note:"5880"},{name:"LUCY",qty:2,st:"normal",note:"5880"}
  ]},
  { id:"c13", name:"3/13高雄櫻花祭", price:"", status:"done", buyers:[
    {name:"151",qty:2,st:"normal"}
  ]},
  { id:"c14", name:"DAY6", price:"預收6000", status:"done", buyers:[
    {name:"萬姊",qty:2,st:"normal"}
  ]},
  { id:"c15", name:"I-dle", price:"", status:"done", buyers:[
    {name:"151",qty:1,st:"normal"},{name:"鄧哥",qty:4,st:"normal"},{name:"萬姊",qty:2,st:"normal"},
    {name:"Jermey",qty:7,st:"normal"},{name:"佳文姊",qty:2,st:"normal"}
  ]},
  { id:"c16", name:"TWICE大巨蛋(2026/3月)", price:"5800", status:"done", note:"二刷$24000未退", buyers:[
    {name:"萬陽",qty:4,st:"normal"}
  ]},
  { id:"c17", name:"蔡健雅2026", price:"", status:"done", note:"需退151 600*2（完成）", buyers:[
    {name:"151",qty:2,st:"normal"},{name:"鄭宇庭chasel",qty:2,st:"normal"}
  ]},
  { id:"c18", name:"林志傑引退賽", price:"4012", status:"done", note:"退費3000*2", buyers:[
    {name:"工程師",qty:2,st:"normal"}
  ]},
];
