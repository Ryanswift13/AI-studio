# 音乐上下文：用户立场 + 艺人关系 + 同名消歧

> 给 DJ 大脑的"音乐世界观"。**选曲前必读**——曾经把 Lana 的 White Dress 解析成 Kanye 的同名歌引发严重事故。
> 用户可以随时增删；改完重启 Claudio 让 context.js 重读语料。

---

## 用户立场（**硬规则，不要违反**）

- **我是 Taylor Swift 粉丝**。这意味着：
  - **永远不选 Kanye West（侃爷）的任何歌**——2009 VMA 抢话筒事件、2016《Famous》"I made that bitch famous"歌词风波、Kim Kardashian 剪辑通话录像、长期公关对立。**硬雷区**。
  - **不选 Kim Kardashian 圈层相关的曲目**（侃爷配偶/前妻阵营）。
  - **Drake 不优先**——Drake 与 Kendrick Lamar 长期 beef（"Not Like Us" 一战定胜负），且 Drake 跟侃爷阵营关系复杂；用户更亲 Kendrick 阵营。Drake 可以偶尔出现但不主动推。
  - **Taylor's Version 优先于原版**——Fearless / Red / Speak Now / 1989 已有 TV 重录的，**永远选 TV**。这跟 Taylor 与 Scooter Braun / Big Machine 的母带战争有关。reputation / Lover 等未重录的用原版即可。
- **不喜欢翻唱、现场版、Remix、伴奏、纯音乐版本**——除非用户明确说要某个特定版本（如他 favorites_all 里收藏的 "爱错 (feat. 单依纯) [Live]" 这种是例外）。

---

## 同名歌消歧（top hit 可能误中，必须按用户偏好选）

| 歌名 | 用户要的版本 | 不要选 |
|---|---|---|
| White Dress | Lana Del Rey（《Chemtrails Over the Country Club》）| Kanye West 任何同名歌 **硬雷区** |
| Cruel Summer | Taylor Swift（《Lover》）| Bananarama 1983 同名原版 |
| 22 | Taylor Swift（Red TV）| 其他歌手任何叫 "22" 的 |
| Style | Taylor Swift（1989 TV）| 其他 |
| Bad Blood | Taylor Swift（1989 TV feat. Kendrick）| 其他 |
| Wildest Dreams | Taylor Swift（1989 TV）| 其他 |
| Love Story | Taylor Swift（Fearless TV）| 其他 |
| Daylight | Taylor Swift（Lover）| 其他歌手叫 Daylight 的 |
| Karma | Taylor Swift（Midnights）| 其他 |
| Look What You Made Me Do | Taylor Swift（reputation）| 其他 |
| August | Taylor Swift（folklore）| 其他叫 August 的 |
| Believer | Imagine Dragons（Evolve）| 其他 |
| Thunder | Imagine Dragons | 其他 |
| Demons | Imagine Dragons | 其他 |
| 晴天 / 稻香 / 夜曲 / 搁浅 | 周杰伦 | 任何翻唱版 |
| 江南 | 林俊杰 | 任何翻唱版 |
| 十年 / 富士山下 | 陈奕迅 | 任何翻唱版 |

> 写台词时**完整传歌名+歌手**到 `play[]`——`{name:"White Dress", artist:"Lana Del Rey"}` 让 ncm.resolve 的 artist 强匹配能过滤错版本。**绝对不要只传歌名**。

---

## 重要事件背景（DJ 写台词时可以引用，但**不要每首都讲，否则油**）

- **2009 VMA 抢话筒**：Kanye 上台打断 19 岁的 Taylor 领奖致辞——Taylor 阵营至今记账。这是恩怨的开端。
- **2016 Famous 事件**：Kanye 新歌里直接喊 Taylor 名字，配偶 Kim Kardashian 公开剪辑通话录像让 Taylor 显得撒谎——后来通话全本流出证明 Taylor 立场是对的，**反转**。"Taylor Swift Is Over Party" tag 那阵 Taylor 沉寂一段时间。
- **2019 母带被卖**：Big Machine（Taylor 旧厂牌）卖给 Scooter Braun（Kanye 阵营经纪人）。Taylor 失去前 6 张专辑母带的所有权——决定**全部重录**。"Taylor's Version" 因此诞生。
- **2020 folklore / evermore**：疫情期间 Taylor 转向 indie folk，与 Aaron Dessner（The National）合作。整张式叙事专辑的代表作。
- **2024 The Tortured Poets Department**：极致私人化的双专辑（TTPD + Anthology），2 小时听完是 immersive 体验，从 Joe Alwyn / Matty Healy / Travis Kelce 三段关系里写出来。
- **2025 The Life of a Showgirl**：与 Sabrina Carpenter 合作，制作回到 Max Martin（Red 时代的金牌制作人）。

---

## 风格 / 流派认知（写台词可点缀，**不堆术语**）

- **folklore / evermore（Taylor 2020）**——indie folk 转向，Aaron Dessner 制作。"日记式叙事专辑"代表。
- **Midnights（Taylor 2022）**——synth-pop + bedroom pop，Jack Antonoff 制作。13 段午夜独白。
- **TTPD（Taylor 2024）**——synth-pop + indie folk 折中，更阴郁。Anthology 31 首是 deep cut 富矿。
- **Imagine Dragons**——arena rock / pop rock。**升力曲**代表。
- **The Weeknd Starboy 时代**——synth-pop / dream pop / 80s 复古。Blinding Lights 那挂。
- **Lana Del Rey**——sadcore / Hollywood sadgirl，电影感叙事。
- **Kendrick Lamar**——西海岸 hip-hop，poet 路线。GNX（2024）是回归大众的作品。
- **千禧华语男声（周杰伦 / 陶喆 / 王力宏 / 林俊杰 / 陈奕迅）**——21 世纪初台湾华语 R&B / 灵魂乐 / 独立中文流行 黄金期。

---

## DJ 选曲前的自检清单

每次选 `play[]` 之前问自己：

1. **歌手 artist 字段填了吗？**——必须填具体歌手名，让 ncm 强匹配能起作用。
2. **是 Taylor 已重录的 6 张专辑里的曲目吗？**——优先选 Taylor's Version。
3. **这首歌名是否在「同名消歧」表里？**——按表选用户要的版本。
4. **侃爷 / Kanye 阵营的歌？**——直接换。
5. **副标题含 (Live)/(翻唱)/(Remix)/(Karaoke)/(伴奏)/(纯音乐)？**——除非用户明说要，换录音室原版。
