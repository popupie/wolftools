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
  {
    id: "ipa-mincho",
    names: ["IPAMincho", "IPA明朝"],
    source: "https://moji.or.jp/ipafont/ipa00303/",
    license: "IPA-1.0",
    preserveFilename: true,
    archive: {
      url: "https://moji.or.jp/wp-content/ipafont/IPAfont/ipam00303.zip",
      sha256:
        "448428496fe30c3c9b13f12c2258aee5b96e34ddc4b2b71b69c7157f159b2999",
    },
    files: [
      {
        filename: "ipam.ttf",
        member: "ipam.ttf",
        sha256:
          "ab923870b9ea047179c14fa78eede8d3957b6bfed26577253b5f08f75c102a34",
      },
      {
        filename: "IPA_Font_License_Agreement_v1.0.txt",
        member: "IPA_Font_License_Agreement_v1.0.txt",
        sha256:
          "4c84dd528ec3044638ec346fc1ee27cd1eb95dfc04cbc6a881b3ca7a7f517e54",
      },
      {
        filename: "Readme_ipam00303.txt",
        member: "Readme_ipam00303.txt",
        sha256:
          "160c75bd994cd095d4d00c997bfe41bc34c36ce76a627f82987a88edbe79ca08",
      },
    ],
  },
  {
    id: "ipa-gothic",
    names: ["IPAGothic", "IPAゴシック"],
    source: "https://moji.or.jp/ipafont/ipa00303/",
    license: "IPA-1.0",
    preserveFilename: true,
    archive: {
      url: "https://moji.or.jp/wp-content/ipafont/IPAfont/ipag00303.zip",
      sha256:
        "b5e6f61de7465476f2f946dd83ee0961dc4d0ceea0833d253bb697297f232d97",
    },
    files: [
      {
        filename: "ipag.ttf",
        member: "ipag.ttf",
        sha256:
          "503af4a8b84d1079b8e2e358dc7f7a7fb8cb7a1f212f35eaef6782dbfc75a55e",
      },
      {
        filename: "IPA_Font_License_Agreement_v1.0.txt",
        member: "IPA_Font_License_Agreement_v1.0.txt",
        sha256:
          "4c84dd528ec3044638ec346fc1ee27cd1eb95dfc04cbc6a881b3ca7a7f517e54",
      },
      {
        filename: "Readme_ipag00303.txt",
        member: "Readme_ipag00303.txt",
        sha256:
          "5ffd382da017f676b41700778e07afa03155dce28323a2cbbadb6bf26be7912e",
      },
    ],
  },
  {
    id: "ipaex-mincho",
    names: ["IPAexMincho", "IPAex明朝"],
    source: "https://moji.or.jp/ipafont/ipaex00401/",
    license: "IPA-1.0",
    preserveFilename: true,
    archive: {
      url: "https://moji.or.jp/wp-content/ipafont/IPAexfont/ipaexm00401.zip",
      sha256:
        "9604c77067396b4d2ab49816b3e18db741a70c8b1d43eb28669ae75cd1ce5237",
    },
    files: [
      {
        filename: "ipaexm.ttf",
        member: "ipaexm.ttf",
        sha256:
          "7a306386f930fee80922f71eebf4ffe0f1ff2817da8e619230953487673d71c7",
      },
      {
        filename: "IPA_Font_License_Agreement_v1.0.txt",
        member: "IPA_Font_License_Agreement_v1.0.txt",
        sha256:
          "4c84dd528ec3044638ec346fc1ee27cd1eb95dfc04cbc6a881b3ca7a7f517e54",
      },
      {
        filename: "Readme_ipaexm00401.txt",
        member: "Readme_ipaexm00401.txt",
        sha256:
          "783ec2703d860575f5eab15bb2b3168da2a8cca76505a1b4fce3cc1ce58694b3",
      },
    ],
  },
  {
    id: "ipaex-gothic",
    names: ["IPAexGothic", "IPAexゴシック"],
    source: "https://moji.or.jp/ipafont/ipaex00401/",
    license: "IPA-1.0",
    preserveFilename: true,
    archive: {
      url: "https://moji.or.jp/wp-content/ipafont/IPAexfont/ipaexg00401.zip",
      sha256:
        "4ab6fee94bf6f94b3eeb31be2b73c559f738dc6b336d722d5301b1f3f592f850",
    },
    files: [
      {
        filename: "ipaexg.ttf",
        member: "ipaexg.ttf",
        sha256:
          "3b9955a5e437ffb24c41548e79296fa724822da21ee75dc1b94f6ccdb8f400dd",
      },
      {
        filename: "IPA_Font_License_Agreement_v1.0.txt",
        member: "IPA_Font_License_Agreement_v1.0.txt",
        sha256:
          "4c84dd528ec3044638ec346fc1ee27cd1eb95dfc04cbc6a881b3ca7a7f517e54",
      },
      {
        filename: "Readme_ipaexg00401.txt",
        member: "Readme_ipaexg00401.txt",
        sha256:
          "567d253f2adb5bc6424fd2592550d225a39f919131e4a0cc0caa4d788e259a60",
      },
    ],
  },
  {
    id: "koku-mincho",
    names: ["Koku Mincho Regular", "刻明朝 Regular"],
    source: "https://freefonts.jp/font-koku-min.html",
    license: "IPA-1.0",
    preserveFilename: true,
    archive: {
      url: "https://freefonts.jp/dl_jajhoi4kagstw/ki_kokumin.zip",
      sha256:
        "0ea4e993499aa7b6f3e9d2355d527209a06572b020d15eb28e822faa5ceb33d2",
    },
    files: [
      {
        filename: "font_1_kokumr_1.00_rls.ttf",
        member: "font_1_kokumr_1.00_rls.ttf",
        sha256:
          "88be4176d46f51f4ca201b97455b37e3d22d85db6ce1f5acd489a307aa34a1c2",
      },
      {
        filename: "IPA_Font_License_Agreement_v1.0.txt",
        member: "IPA_Font_License_Agreement_v1.0.txt",
        sha256:
          "4c84dd528ec3044638ec346fc1ee27cd1eb95dfc04cbc6a881b3ca7a7f517e54",
      },
      {
        filename: "readme.txt",
        member: "readme.txt",
        sha256:
          "54d621f1f70d040d5cbd11d2c018f16141bb78da0efdaa650e5e5001e87cceef",
      },
    ],
    replacement: {
      source: "https://moji.or.jp/ipafont/ipaex00201/",
      files: ["ipaexm.ttf", "ipaexg.ttf"],
    },
  },
  {
    id: "yasashisa-antique",
    names: ["07YasashisaAntique", "07やさしさアンチック"],
    source: "https://www.fontna.com/blog/yasashisaAntique.html",
    license: "IPA-1.0",
    preserveFilename: true,
    archive: {
      url: "https://www.fontna.com/font/YasashisaAntiqueFont2.zip",
      sha256:
        "b2ca9a23956cdd29ac4f4eb36f57267ff446f7d1ba110c9587ceb8ec02551a45",
    },
    files: [
      {
        filename: "07YasashisaAntique.otf",
        member: "07YasashisaAntique.otf",
        sha256:
          "174ed20be56a1ac0515d6688a6eeca9625bfa9d5902bdb355d922e04b4051251",
      },
      {
        filename: "IPA_Font_License_Agreement_v1.0.txt",
        member: "IPA_Font_License_Agreement_v1.0.txt",
        sha256:
          "4c84dd528ec3044638ec346fc1ee27cd1eb95dfc04cbc6a881b3ca7a7f517e54",
      },
      {
        filename: "LICENSE_E",
        member: "LICENSE_E",
        sha256:
          "907e9f5ac24cba6ce2523cd2a66d6ba143e082c685344dfa8d30ef12f67410a0",
      },
      {
        filename: "LICENSE_J",
        member: "LICENSE_J",
        sha256:
          "b831d51b4b20640091a3e6e6947a209f7a4287c7d384638a907ea838399b3405",
      },
      {
        filename: "ReadMe_windows.txt",
        member: "ReadMe_windows.txt",
        sha256:
          "bd9bf5bed9f6abf6cf712efe6935550ae9d8f5b98dd86776a4028cb15bfa62f7",
      },
    ],
    replacement: {
      source: "https://moji.or.jp/ipafont/ipaex00201/",
      files: ["ipaexm.ttf", "ipaexg.ttf"],
    },
  },
  {
    id: "yasashisa-gothic",
    names: ["07YasashisaGothic", "07やさしさゴシック"],
    source: "https://www.fontna.com/blog/yasashigothic.html",
    license: "IPA-1.0",
    preserveFilename: true,
    archive: {
      url: "https://www.fontna.com/font/07Yasashisa.zip",
      sha256:
        "9300b359f2855bf27a4c1968865192255da4c0530ae8c70d842c601a5111c612",
      filenameEncoding: "shift_jis",
    },
    files: [
      {
        filename: "07やさしさゴシック.ttf",
        member: "07やさしさゴシック.ttf",
        sha256:
          "0af615719092057e63a878db9ed22d683ad63427894455a8e374aafb4936e127",
      },
      {
        filename: "IPA_Font_License_Agreement_v1.0.txt",
        member: "IPA_Font_License_Agreement_v1.0.txt",
        sha256:
          "4c84dd528ec3044638ec346fc1ee27cd1eb95dfc04cbc6a881b3ca7a7f517e54",
      },
      {
        filename: "LICENSE_E",
        member: "LICENSE_E",
        sha256:
          "3f619ceb96e0e48e69b0e36f6cb90f9cf0553d5038da3602c464851b3883875a",
      },
      {
        filename: "LICENSE_J",
        member: "LICENSE_J",
        sha256:
          "efdde2a1e8b1e018b152c29e45ec8d66eb5f829cffaab5b07461b6f06a30c758",
      },
      {
        filename: "ReadMe_windows.txt",
        member: "ReadMe_windows.txt",
        sha256:
          "ca17321501594c15df18e7c20327d43be5750e8c3782cd7dd28c6f524b0e22e5",
      },
    ],
    replacement: {
      source: "https://moji.or.jp/ipafont/ipa00303/",
      files: ["ipag.ttf"],
    },
  },
  {
    id: "ipa-p-mincho",
    names: ["IPAPMincho", "IPA P明朝"],
    source: "https://moji.or.jp/ipafont/ipa00303/",
    license: "IPA-1.0",
    preserveFilename: true,
    archive: {
      url: "https://moji.or.jp/wp-content/ipafont/IPAfont/ipamp00303.zip",
      sha256:
        "d549b10e31ca79c8f0c11df1b613e5e35b93cd01519fdcde17ba88d097cb96a7",
      filenameEncoding: "shift_jis",
    },
    files: [
      {
        filename: "ipamp.ttf",
        member: "ipamp.ttf",
        sha256:
          "75c2fd0b6f3f2b2c56a95b7ac2236034a04e0b83605ffb6d149b6dcbbcfb06fb",
      },
      {
        filename: "IPA_Font_License_Agreement_v1.0.txt",
        member: "IPA_Font_License_Agreement_v1.0.txt",
        sha256:
          "4c84dd528ec3044638ec346fc1ee27cd1eb95dfc04cbc6a881b3ca7a7f517e54",
      },
      {
        filename: "Readme_ipamp00303.txt",
        member: "Readme_ipamp00303.txt",
        sha256:
          "4d23306b1a375a6b7707b99792d81161cf8cce08211dc68ec0fa11db8dc5f8a7",
      },
    ],
  },
  {
    id: "ipa-p-gothic",
    names: ["IPAPGothic", "IPA Pゴシック"],
    source: "https://moji.or.jp/ipafont/ipa00303/",
    license: "IPA-1.0",
    preserveFilename: true,
    archive: {
      url: "https://moji.or.jp/wp-content/ipafont/IPAfont/ipagp00303.zip",
      sha256:
        "da84ddb85178c84b0c4adad9b867dd9a46bacb72a1f276cbcc2d6923b6657102",
      filenameEncoding: "shift_jis",
    },
    files: [
      {
        filename: "ipagp.ttf",
        member: "ipagp.ttf",
        sha256:
          "a63f6153841e56ec9df1b31a54d98d3f41d8aaa1c3d8df30a33502296f5b8068",
      },
      {
        filename: "IPA_Font_License_Agreement_v1.0.txt",
        member: "IPA_Font_License_Agreement_v1.0.txt",
        sha256:
          "4c84dd528ec3044638ec346fc1ee27cd1eb95dfc04cbc6a881b3ca7a7f517e54",
      },
      {
        filename: "Readme_ipagp00303.txt",
        member: "Readme_ipagp00303.txt",
        sha256:
          "d7bd94af630579522fbf15e8e6939fc8160c33e700127d3f0735ce64b88b9e2b",
      },
    ],
  },
  {
    id: "yasashisa-gothic-bold",
    names: ["07YasashisaGothicBold", "07やさしさゴシックボールド"],
    source: "https://www.fontna.com/blog/yasashisagothic_b.html",
    license: "MPLUS",
    preserveFilename: true,
    archive: {
      url: "https://www.fontna.com/font/07YasashisaBold.zip",
      sha256:
        "41e04df1727e8987048ac8a1593f8584bc570d1438a5f6d2673f593f8a11873d",
      filenameEncoding: "shift_jis",
    },
    files: [
      {
        filename: "07やさしさゴシックボールド.ttf",
        member: "07やさしさゴシックボールド.ttf",
        sha256:
          "0f5627b66aedb67878b3126f8d9640b18731daa671f6786f65a5af8fa3549d82",
      },
      {
        filename: "LICENSE_E",
        member: "LICENSE_E",
        sha256:
          "3270870b8554cd394453ff27d005fa996060f3801e880fdad15aa43a6fca0745",
      },
      {
        filename: "LICENSE_J",
        member: "LICENSE_J",
        sha256:
          "da6efd420ebebcb2f10e5ffa44c8206f79c385ea3f9fb02447368785094e37f0",
      },
      {
        filename: "ReadMe_windows.txt",
        member: "ReadMe_windows.txt",
        sha256:
          "3823bc2d09880266acf7a3f56b6756079d6ceb79efb5dcc4980ad370b0497c43",
      },
    ],
  },
  {
    id: "yasashisa-gothic-bold-otf",
    names: [
      "YasashisaBoldt",
      "YasashisaBoldOTEditFont",
      "07YasashisaBold",
      "YasashisaBoldFont",
    ],
    source: "https://www.fontna.com/blog/yasashisagothic_b.html",
    license: "MPLUS",
    preserveFilename: true,
    archive: {
      url: "https://www.fontna.com/font/07YasashisaBold.zip",
      sha256:
        "41e04df1727e8987048ac8a1593f8584bc570d1438a5f6d2673f593f8a11873d",
      filenameEncoding: "shift_jis",
    },
    files: [
      {
        filename: "YasashisaBold.otf",
        member: "YasashisaBold.otf",
        sha256:
          "1f16614601675ad1dc688dff5ebbad275cf67658d5c759e81eb4392d0356a670",
      },
      {
        filename: "LICENSE_E",
        member: "LICENSE_E",
        sha256:
          "3270870b8554cd394453ff27d005fa996060f3801e880fdad15aa43a6fca0745",
      },
      {
        filename: "LICENSE_J",
        member: "LICENSE_J",
        sha256:
          "da6efd420ebebcb2f10e5ffa44c8206f79c385ea3f9fb02447368785094e37f0",
      },
      {
        filename: "ReadMe_windows.txt",
        member: "ReadMe_windows.txt",
        sha256:
          "3823bc2d09880266acf7a3f56b6756079d6ceb79efb5dcc4980ad370b0497c43",
      },
    ],
  },
  {
    id: "genei-latego-v1",
    names: [
      "GenEi LateGo",
      "GenEi LateGo Medium",
      "源暎ラテゴ",
      "源暎ラテゴ Medium",
    ],
    source: "https://okoneya.jp/font/genei-latin.html",
    license: "OFL-1.1",
    preserveFilename: true,
    archive: {
      url: "https://okoneya.jp/font/GenEiLatin-1.0.zip",
      sha256:
        "8db3a041ebcf430a30209a85370e995a77892ef894264a2bb6e7c40bcb604451",
      filenameEncoding: "shift_jis",
    },
    files: [
      {
        filename: "GenEiLateGo.otf",
        member: "GenEiLateGo.otf",
        sha256:
          "8282569a56831a3207903f409278d4bb498c57ccb9744f0b2a205bf2a1a4e2fb",
      },
      {
        filename: "LICENSE.txt",
        member: "LICENSE.txt",
        sha256:
          "1beea52b7cf6b8f5fa3120f3b6fc4bd5828037bdbe513624ea55100876654c18",
      },
      {
        filename: "readme_説明書.txt",
        member: "readme_説明書.txt",
        sha256:
          "5b8403c14a0ef0add57f6157616df9e83c43a7c7c82e2f018726f9e42826bb7e",
      },
    ],
  },
  {
    id: "genei-latemin-v1",
    names: [
      "GenEi LateMin",
      "GenEi LateMin Medium",
      "源暎ラテミン",
      "源暎ラテミン Medium",
    ],
    source: "https://okoneya.jp/font/genei-latin.html",
    license: "OFL-1.1",
    preserveFilename: true,
    archive: {
      url: "https://okoneya.jp/font/GenEiLatin-1.0.zip",
      sha256:
        "8db3a041ebcf430a30209a85370e995a77892ef894264a2bb6e7c40bcb604451",
      filenameEncoding: "shift_jis",
    },
    files: [
      {
        filename: "GenEiLateMin.otf",
        member: "GenEiLateMin.otf",
        sha256:
          "d3ad6f612892937aed213e93df4ef52edc64faa506951b57dea82a867a31184f",
      },
      {
        filename: "LICENSE.txt",
        member: "LICENSE.txt",
        sha256:
          "1beea52b7cf6b8f5fa3120f3b6fc4bd5828037bdbe513624ea55100876654c18",
      },
      {
        filename: "readme_説明書.txt",
        member: "readme_説明書.txt",
        sha256:
          "5b8403c14a0ef0add57f6157616df9e83c43a7c7c82e2f018726f9e42826bb7e",
      },
    ],
  },
  {
    id: "genei-latego-v2",
    names: [
      "GenEi LateGo v2",
      "GenEi LateGo v2 Medium",
      "源暎ラテゴ v2",
      "源暎ラテゴ v2 Medium",
      "GenEi LateGo P v2",
      "GenEi LateGo P v2 Medium",
      "源暎ラテゴ 詰 v2",
      "源暎ラテゴ 詰 v2 Medium",
    ],
    source: "https://okoneya.jp/font/genei-latin.html",
    license: "OFL-1.1",
    preserveFilename: false,
    archive: {
      url: "https://okoneya.jp/font/GenEiLatin_v2.1.zip",
      sha256:
        "fd90686434bd794196edd2102c40068d3cbb35001d0d2819722314b6a44cdddc",
      filenameEncoding: "shift_jis",
    },
    files: [
      {
        filename: "GenEiLateGo_v2.ttc",
        member: "GenEiLateGo_v2.ttc",
        sha256:
          "02e3e8292aaad3eddab278032f78395ddbf416a1656e720e0322a8db795af67b",
      },
      {
        filename: "LICENSE.txt",
        member: "LICENSE.txt",
        sha256:
          "1beea52b7cf6b8f5fa3120f3b6fc4bd5828037bdbe513624ea55100876654c18",
      },
      {
        filename: "readme_説明書.txt",
        member: "readme_説明書.txt",
        sha256:
          "3966d7f6e25d9ee1ed7d9cbd53d357f9d3c286d403d545db02bcefc433b6ab53",
      },
    ],
  },
  {
    id: "genei-latemin-v2",
    names: [
      "GenEi LateMin v2",
      "GenEi LateMin v2 Medium",
      "源暎ラテミン v2",
      "源暎ラテミン v2 Medium",
      "GenEi LateMin P v2",
      "GenEi LateMin P v2 Medium",
      "源暎ラテミン 詰 v2",
      "源暎ラテミン 詰 v2 Medium",
    ],
    source: "https://okoneya.jp/font/genei-latin.html",
    license: "OFL-1.1",
    preserveFilename: false,
    archive: {
      url: "https://okoneya.jp/font/GenEiLatin_v2.1.zip",
      sha256:
        "fd90686434bd794196edd2102c40068d3cbb35001d0d2819722314b6a44cdddc",
      filenameEncoding: "shift_jis",
    },
    files: [
      {
        filename: "GenEiLateMin_v2.ttc",
        member: "GenEiLateMin_v2.ttc",
        sha256:
          "cc6dd2a6f0f744fb525b825d24c46d65023871a2b8a8a7a614e55862cdcbe383",
      },
      {
        filename: "LICENSE.txt",
        member: "LICENSE.txt",
        sha256:
          "1beea52b7cf6b8f5fa3120f3b6fc4bd5828037bdbe513624ea55100876654c18",
      },
      {
        filename: "readme_説明書.txt",
        member: "readme_説明書.txt",
        sha256:
          "3966d7f6e25d9ee1ed7d9cbd53d357f9d3c286d403d545db02bcefc433b6ab53",
      },
    ],
  },
  {
    id: "yasashisa-gothic-bold-v2",
    names: [
      "YasashisaGothicBoldV2 bold",
      "YasashisaGothicBoldV2 bold Bold",
      "YasashisaGothicBoldV2",
      "やさしさゴシックボールドV2",
      "やさしさゴシックボールドV2 Bold",
    ],
    source: "https://booth.pm/ja/items/1833993",
    license: "MPLUS",
    copyright: "Fontna.com / Kato Masashi, 2019; M+ FONTS PROJECT, 2002-2019",
    preserveFilename: true,
    files: [
      {
        filename: "YasashisaGothicBold-V2.otf",
        url: "https://akiba-eventmap.com/fonts/yasashisagothic/YasashisaGothicBold-V2.otf",
        sha256:
          "4b4fe0d427ea0a79fd19fe3f8b01feeb571f6b04302159acb4465d6a5822fa0c",
      },
      {
        filename: "LICENSE_E",
        url: "https://raw.githubusercontent.com/Japont/Japont-fonts/54e809086cfca96a9f7459f70dfe65476660f58d/fontna-mplus/mplus-TESTFLIGHT-059/LICENSE_E",
        sha256:
          "2d499d752eca1988766eeca70d4145fd94793579924702629181d0ed63dd51a7",
      },
      {
        filename: "LICENSE_J",
        url: "https://raw.githubusercontent.com/Japont/Japont-fonts/54e809086cfca96a9f7459f70dfe65476660f58d/fontna-mplus/mplus-TESTFLIGHT-059/LICENSE_J",
        sha256:
          "66b4cd071d8b2e8a69db344604c00aec7e81192dd9c0c9657979b142310cc3ab",
      },
    ],
  },
];
