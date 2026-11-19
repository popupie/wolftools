const toropo =
  "https://raw.githubusercontent.com/Japont/Japont-fonts/54e809086cfca96a9f7459f70dfe65476660f58d/toropo";
const ume = "https://sources.debian.org/data/main/f/fonts-horai-umefont/670-5";

export const FONT_CATALOG = [
  {
    id: "07-logotype-gothic-condense",
    names: ["07LogoTypeGothic-Condense", "07ロゴたいぷゴシックCondense"],
    source: "https://www.fontna.com/blog/logotypegothic_c.html",
    archive: {
      url: "https://www.fontna.com/font/LogoTypeGothicCondense.zip",
      sha256:
        "024658209da565ef7c8693ea04a012c0c7818f003560613a597942fc07c31fd2",
    },
    files: [
      {
        filename: "07LogoTypeGothic-Condense.ttf",
        member: "07LogoTypeGothic-Condense.ttf",
        sha256:
          "eeb52a5d91c7f3645bde28c6e0998c69c7270c546353fd826d0e3c532dbe84cb",
      },
      {
        filename: "LICENSE_E",
        member: "LICENSE_E",
        sha256:
          "2d499d752eca1988766eeca70d4145fd94793579924702629181d0ed63dd51a7",
      },
      {
        filename: "LICENSE_J",
        member: "LICENSE_J",
        sha256:
          "66b4cd071d8b2e8a69db344604c00aec7e81192dd9c0c9657979b142310cc3ab",
      },
      {
        filename: "ReadMe_Mac.txt",
        member: "ReadMe_Mac.txt",
        sha256:
          "c843bf52d8027d60c8fa5f1603ca1626fae12f14f1068451a4e94a00f385f0e8",
      },
    ],
  },
  {
    id: "nemuke-medium",
    names: ["NemukeMedium"],
    source: "https://goodfreefonts.com/8283/",
    archive: {
      url: "https://goodfreefonts.com/wp-content/uploads/2025/07/nemuke-hokkori-font.zip",
      sha256:
        "45cc32abe1bf3033aacad224fb60d9eab7a3b7c31975fa8b3dc592487fb019ae",
    },
    files: [
      {
        filename: "NemukeMedium.otf",
        member: "NemukeMedium.otf",
        sha256:
          "7983e1cf9ec13a2843d2c5194fc27125c5917f5ebed59b9fb29d263dfa35ab1e",
      },
      {
        // The author's public-domain notice, preserved by Japont.
        filename: "ReadMe.txt",
        url: `${toropo}/ReadMe.txt`,
        sha256:
          "63479f2dbf2b5afc01b502f6e728f44213e19a8f7a7548d9b8f6bd5bfecdec0a",
      },
    ],
  },
  {
    id: "ume-gothic",
    names: ["Ume Gothic", "梅ゴシック"],
    source: "https://sources.debian.org/src/fonts-horai-umefont/670-5/",
    files: [
      {
        filename: "ume-tgo4.ttf",
        url: `${ume}/ume-tgo4.ttf`,
        sha256:
          "46b4748d44e9038801c6d116ad7cc59271ef3c275785b385d541543e5db0f781",
      },
      {
        filename: "license.html",
        url: `${ume}/license.html`,
        sha256:
          "88d5d5a1bf928ff316e3f80d2e665b1a3ab0f46af80ae7d1ec0046b16ea64cdb",
      },
    ],
  },
];
