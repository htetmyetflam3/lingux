
{
  "minimal_sentence_patterns": [
    {
      "id": "MSP_01",
      "pattern": "VERB_ONLY",
      "description": "ကြိယာပုဒ်တစ်ခုတည်းဖြင့် ဖွဲ့စည်းနိုင်သည် (imperative, negative, optative, hortative)",
      "elements": ["VERB"],
      "particles": [],
      "particle_count": 0,
      "examples": ["စားမလား။", "မစားချင်ဘူး။", "စားလိုက်ပါဦး။", "ချမ်းသာကြပါစေ။"],
      "reference": "§113(က)"
    },
    {
      "id": "MSP_02",
      "pattern": "NOUN_ONLY",
      "description": "နာမ်ပုဒ်တစ်ခုတည်းဖြင့် ဖွဲ့စည်းနိုင်သည် (ရှေ့စကားကို မှီ၍ အဓိပ္ပာယ်ပြည့်စုံ)",
      "elements": ["NOUN"],
      "particles": [],
      "particle_count": 0,
      "examples": ["မောင်မောင်။", "မြစ်ကြီးနားက။", "အမြန်ရထားနဲ့။", "ဈေးကို။", "စနေနေ့ညနေ။", "ဦးဘိုးချစ်သမီး။"],
      "reference": "§113(ခ)"
    },
    {
      "id": "MSP_03",
      "pattern": "NOUN_OBJ + VERB",
      "description": "နာမ်ပုဒ် (ကံ) တစ်ခုနှင့် ကြိယာပုဒ်တစ်ခုပါသည့် အနည်းဆုံးဝါကျ",
      "elements": ["NOUN_OBJ", "VERB"],
      "particles": [],
      "particle_count": 0,
      "examples": ["အမှိုက် မပုံရ။", "ကြော်ငြာ မကပ်ရ။", "အိပ်ရာ သိမ်း။", "သွား တိုက်။", "အငှားကား စီးသွားပါလား။", "ထမင်း စားပါဦး။"],
      "reference": "§114(က)"
    },
    {
      "id": "MSP_04",
      "pattern": "NOUN_LOC + VERB",
      "description": "နာမ်ပုဒ် (နေရာပြ) တစ်ခုနှင့် ကြိယာပုဒ်တစ်ခုပါသည့် အနည်းဆုံးဝါကျ",
      "elements": ["NOUN_LOC", "VERB"],
      "particles": [],
      "particle_count": 0,
      "examples": ["ဘယ်မှာ နေသလဲ။", "ထမင်းဆိုင်မှာ စားမလား။", "ဒီမှာ တည်းပါ။", "မြန်မာပြည်မှာ လုပ်သည်။"],
      "reference": "§114(ခ)"
    },
    {
      "id": "MSP_05",
      "pattern": "NOUN + ELLIPTICAL_VERB + PARTICLE",
      "description": "ကြိယာပုဒ်ကို မြှုပ်၍ နာမ်ပုဒ်၊ နာမ်ပုဒ်စုများဖြင့် ဖွဲ့စည်းနိုင်သည်",
      "elements": ["NOUN", "(VERB)", "PARTICLE"],
      "particles": [],
      "particle_count": 0,
      "examples": [
        "ထိုပညောင်ပင် တစ်မူကား အာဠာဝက ဘီလူးနေရာတည်း။",
        "ငါးပါးသော်ကား-ပေးကမ်းခြင်း၊ ချစ်ဖွယ်သောစကားကိုဆိုခြင်း၊ အကျိုးစီးပွားကိုဆောင်ခြင်း၊ ကိုယ်နှင့်အတူကျင့်ခြင်း၊ မချွတ်မယွင်းခြင်းတည်း။",
        "သစ်ပင်၊ သစ်ကိုင်း၊ သစ်ခက်၊ သစ်ညွန့်၊ သစ်ပွင့်၊ သစ်သီးတို့သည်လည်း အဋ္ဌကလာပ်ရုပ်အစုတို့၏ အရိပ်ကြီးငယ်တို့သာတည်း။"
      ],
      "reference": "§114(ခ)"
    },
    {
      "id": "MSP_06",
      "pattern": "SUBJ + [SOURCE/GOAL/INSTR/TIME] + VERB (incremental)",
      "description": "ကတ္တားပုဒ်၊ ကြိယာပုဒ်အခြေခံ၌ နာမ်ပုဒ်များကို လိုအပ်သလို ဖြည့်စွက်ဖွဲ့စည်းနိုင်သည်",
      "elements": ["SUBJ", "[OPTIONAL_ADJUNCTS]", "VERB"],
      "particles": [],
      "particle_count": 0,
      "examples": [
        "ဦးဘသည် ပြန်လာသည်။",
        "ဦးဘသည် မန္တလေးမှ ပြန်လာသည်။",
        "ဦးဘသည် မန္တလေးမှ ရန်ကုန်သို့ ပြန်လာသည်။",
        "ဦးဘသည် မန္တလေးမှ ရန်ကုန်သို့ မီးရထားဖြင့် ပြန်လာသည်။",
        "ဦးဘသည် မန္တလေးမှ ရန်ကုန်သို့ မီးရထားဖြင့် မနေ့က ပြန်လာသည်။",
        "ဦးဘသည် မောင်မောင်နှင့်အတူ မန္တလေးမှ ရန်ကုန်သို့ မီးရထားဖြင့် မနေ့ကပြန်လာသည်။"
      ],
      "reference": "§115"
    },
    {
      "id": "MSP_07",
      "pattern": "FRONTED_TOPIC + SUBJ + [ADJUNCTS] + VERB",
      "description": "ဝါကျတွင်ပါသော နာမ်ပုဒ်များအနက်မှ အလေးပေးလိုသည့်နာမ်ပုဒ်ကို ဝါကျရှေ့ဆုံး၌ထား၍ ဖွဲ့စည်းနိုင်သည်",
      "elements": ["FRONTED_TOPIC", "SUBJ", "[ADJUNCTS]", "VERB"],
      "particles": [],
      "particle_count": 0,
      "examples": [
        "ဦးဘသည် မန္တလေးမှ ပြန်လာသည်။",
        "မန္တလေးမှ ဦးဘ ပြန်လာသည်။",
        "အမြန်ရထားဖြင့် မန္တလေးမှ ဦးဘပြန်လာသည်။",
        "မနေ့က မန္တလေးမှ အမြန်ရထားဖြင့် ဦးဘပြန်လာသည်။",
        "မောင်မောင်နှင့်အတူ ဦးဘသည် မောင်မောင်နှင့်အတူ မန္တလေးမှ အမြန်ရထားဖြင့် မနေ့က ပြန်လာသည်။"
      ],
      "reference": "§116"
    }
  ],
  "clause_types": {
    "main_clause": [
      {
        "pattern": "SUBJ + [MODIFIERS] + VERB + [END_PARTICLE]",
        "can_stand_alone": true,
        "example": "ကျွန်တော်မြင်သည်။"
      }
    ],
    "subordinate_clause": {
      "noun_clause": [
        {
          "pattern": "SUBJ + VERB + NOUN_CONNECTOR",
          "connectors": ["ကို", "မှာ", "က"],
          "functions": ["SUBJ", "OBJ", "SUBJ_COMPLEMENT"],
          "example": "မောင်မောင်ပြန်လာသည်ကို ကျွန်တော်တွေ့သည်။"
        }
      ],
      "adjective_clause": [
        {
          "pattern": "SUBJ + VERB + ADJ_CONNECTOR",
          "connectors": ["သော", "သည့်", "မည့်"],
          "function": "MODIFIES_NOUN",
          "example": "သူကျွေးသော မုန့်ကို ကျွန်တော်စားသည်။"
        }
      ],
      "adverbial_clause": {
        "concessive": [
          {
            "pattern": "SUBJ + [OBJ] + VERB + CONCESSIVE_CONNECTOR",
            "connectors": ["သော်လည်း", "စေကာမူ"],
            "example": "မောင်မောင်သည်စာကြိုးစားသော်လည်း ဂုဏ်ထူးမရချေ။"
          }
        ],
        "temporal": [
          {
            "pattern": "SUBJ + [OBJ] + VERB + TEMPORAL_CONNECTOR",
            "connectors": ["သောအခါ", "နှင့်တစ်ပြိုင်နက်"],
            "example": "ဆရာအတန်းထဲသို့ဝင်လာသောအခါ ကျောင်းသားများ မတ်တတ်ရပ်ကြသည်။"
          }
        ],
        "purposive": [
          {
            "pattern": "SUBJ + [OBJ] + VERB + PURPOSE_CONNECTOR",
            "connectors": ["အောင်", "ရန်"],
            "example": "ကျောင်းသားတိုင်းလိမ္မာအောင် ဆရာက သွန်သင်သည်။"
          }
        ],
        "causal": [
          {
            "pattern": "SUBJ + [OBJ] + VERB + CAUSAL_CONNECTOR",
            "connectors": ["သောကြောင့်", "သဖြင့်"],
            "example": "သူကူညီသောကြောင့် ကျွန်တော့်လုပ်ငန်းများ အောင်မြင်သည်။"
          }
        ],
        "comparative": [
          {
            "pattern": "SUBJ + [OBJ] + VERB + COMPARATIVE_CONNECTOR",
            "connectors": ["သကဲ့သို့", "သလို"],
            "example": "ခြင်္သေ့မင်းသည် သတ္တိရှိသကဲ့သို့ မြန်မာ့တပ်မတော်သားတို့သည် သတ္တိရှိကြသည်။"
          }
        ],
        "conditional_restrictive": [
          {
            "pattern": "SUBJ + [OBJ] + VERB + RESTRICTIVE_CONNECTOR",
            "connectors": ["လျှင်", "မှ"],
            "example": "သားသမီးလိမ္မာလျှင် မိဘစိတ်ချမ်းသာမည်။"
          }
        ],
        "conditional_unrestricted": [
          {
            "pattern": "SUBJ + [OBJ] + VERB + UNRESTRICTIVE_CONNECTOR",
            "connectors": ["ဖြစ်စေ…ဖြစ်စေ", "လျှင်သော်လည်းကောင်း…လျှင်သော်လည်းကောင်း"],
            "example": "မိုးရွာသည်ဖြစ်စေ၊ မရွာသည်ဖြစ်စေ ကျွန်တော်လာမည်။"
          }
        ],
        "quantitative": [
          {
            "pattern": "SUBJ + [OBJ] + VERB + QUANTITY_CONNECTOR",
            "connectors": ["သလောက်", "ကာမျှဖြင့်"],
            "example": "ကျွန်ုပ်၏အိမ်တွင်နေချင်သလောက် သင်နေနိုင်ပါသည်။"
          }
        ],
        "modal": [
          {
            "pattern": "SUBJ + [OBJ] + VERB + MODAL_CONNECTOR",
            "connectors": ["လျက်", "ကာ"],
            "example": "ကလေးများသည် ခုန်ပေါက်လျက် ကျောင်းမှပြန်လာကြသည်။"
          }
        ]
      }
    }
  },
  "clause_taxonom": {
    "noun_clauses": [
      {
        "id": "CT_NC_01",
        "type": "နာမ်ဝါကျကဏ္ဍ",
        "description": "ကတ္တားနှင့်ကြိယာပါရှိပြီး နာမ်သဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ",
        "ending_markers": ["ကို", "မှာ", "က"],
        "function": "functions as subject or object of the main clause",
        "examples": [
          {"subordinate": "မောင်မောင်ပြန်လာသည်ကို", "main": "ကျွန်တော်တွေ့သည်။", "function_in_main": "object"},
          {"subordinate": "သူပြောသည်မှာ", "main": "အမှန်ဖြစ်သည်။", "function_in_main": "subject"},
          {"subordinate": "သူပထမရသည်က", "main": "များသည်။", "function_in_main": "subject"}
        ],
        "reference": "§149(က), §150"
      }
    ],
    "adjective_clauses": [
      {
        "id": "CT_AC_01",
        "type": "နာမဝိသေသနဝါကျကဏ္ဍ",
        "description": "ကတ္တားနှင့်ကြိယာပါရှိပြီး နာမဝိသေသန သဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ",
        "ending_markers": ["သော", "သည့်", "မည့်"],
        "function": "modifies a noun in the main clause (adjectival function)",
        "examples": [
          {"subordinate": "သူ ကျွေးသော", "modified_noun": "မုန့်ကို", "main": "ကျွန်တော်စားသည်။"},
          {"subordinate": "မောင်မောင် စားချင်သည့်", "modified_noun": "ဟင်းမှာ", "main": "ကြက်သားဟင်းဖြစ်သည်။"},
          {"subordinate": "ကျောင်းသားများ စာမေးပွဲဖြေရမည့်", "modified_noun": "ရက်ကို", "main": "ဆရာကြီးက ကြေညာပြီ။"}
        ],
        "reference": "§149(ခ), §151"
      }
    ],
    "adverbial_clauses": [
      {
        "id": "CT_AVC_01",
        "subtype": "ဆန့်ကျင်ပြကြိယာဝိသေသနဝါကျကဏ္ဍ",
        "description": "ဆန့်ကျင်ခြင်းအနက်ဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ",
        "ending_markers": ["သော်လည်း", "စေကာမူ"],
        "function": "contrastive modification of the main verb",
        "example": "မောင်မောင်သည်စာကြိုးစားသော်လည်း ဂုဏ်ထူးမရချေ။",
        "reference": "§122(က)"
      },
      {
        "id": "CT_AVC_02",
        "subtype": "အချိန်ပြကြိယာဝိသေသနဝါကျကဏ္ဍ",
        "description": "အချိန်ကာလကို ဖော်ပြခြင်းဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ",
        "ending_markers": ["သောအခါ", "နှင့်တစ်ပြိုင်နက်"],
        "function": "temporal modification of the main verb",
        "example": "ဆရာအတန်းထဲသို့ဝင်လာသောအခါ ကျောင်းသားများ မတ်တတ်ရပ်ကြသည်။",
        "reference": "§122(ခ)"
      },
      {
        "id": "CT_AVC_03",
        "subtype": "အကျိုးမျှော်ပြကြိယာဝိသေသနဝါကျကဏ္ဍ",
        "description": "အကျိုးတစ်စုံတစ်ရာ မျှော်လင့်ခြင်းအနက်ဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ",
        "ending_markers": ["အောင်", "ရန်"],
        "function": "purpose modification of the main verb",
        "example": "ကျောင်းသားတိုင်းလိမ္မာအောင် ဆရာက သွန်သင်သည်။",
        "reference": "§122(ဂ)"
      },
      {
        "id": "CT_AVC_04",
        "subtype": "အကြောင်းပြကြိယာဝိသေသနဝါကျကဏ္ဍ",
        "description": "အကြောင်းပြခြင်းအနက်ဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ",
        "ending_markers": ["သောကြောင့်", "သဖြင့်"],
        "function": "causal modification of the main verb",
        "example": "သူကူညီသောကြောင့် ကျွန်တော်၏လုပ်ငန်းများ အောင်မြင်သည်။",
        "reference": "§122(ဃ)"
      },
      {
        "id": "CT_AVC_05",
        "subtype": "နှိုင်းယှဉ်ပြကြိယာဝိသေသနဝါကျကဏ္ဍ",
        "description": "သက်ရှိ၊ သက်မဲ့ စသည်တို့ကို တစ်ခုနှင့်တစ်ခု နှိုင်းယှဉ်သည့်အနက်ဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ",
        "ending_markers": ["သကဲ့သို့", "သလို"],
        "function": "comparative modification of the main verb",
        "example": "ခြင်္သေ့မင်းသည် သတ္တိရှိသကဲ့သို့ မြန်မာ့တပ်မတော်သားတို့သည် သတ္တိရှိကြသည်။",
        "reference": "§122(င)"
      },
      {
        "id": "CT_AVC_06",
        "subtype": "ကန့်သတ်ချက်ပြကြိယာဝိသေသနဝါကျကဏ္ဍ",
        "description": "တစ်စုံတစ်ရာသော အခြေအနေကို ကန့်သတ်သည့်အနက်ဖြင့်ဖြစ်စေ၊ စည်းကမ်းသတ်မှတ်သည့်အနက်ဖြင့်ဖြစ်စေ ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ",
        "ending_markers": ["လျှင်", "မှ"],
        "function": "conditional modification of the main verb",
        "example": "သားသမီးလိမ္မာလျှင် မိဘစိတ်ချမ်းသာမည်။",
        "reference": "§122(စ)"
      },
      {
        "id": "CT_AVC_07",
        "subtype": "ကန့်သတ်မဲ့ပြကြိယာဝိသေသနဝါကျကဏ္ဍ",
        "description": "တစ်စုံတစ်ရာသော အခြေအနေကို ကန့်သတ်ခြင်းမရှိသည့်အနက်ဖြင့်ဖြစ်စေ ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ",
        "ending_markers": ["ဖြစ်စေ…ဖြစ်စေ", "လျှင်သော်လည်းကောင်း…လျှင်သော်လည်းကောင်း"],
        "function": "unconditional modification of the main verb",
        "example": "မိုးရွာသည်ဖြစ်စေ၊ မရွာသည်ဖြစ်စေ ကျွန်တော်လာမည်။",
        "reference": "§122(ဆ)"
      },
      {
        "id": "CT_AVC_08",
        "subtype": "ပမာဏပြကြိယာဝိသေသနဝါကျကဏ္ဍ",
        "description": "ပမာဏကို ဖော်ပြခြင်းဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ",
        "ending_markers": ["သလောက်", "ကာမျှဖြင့်"],
        "function": "quantitative modification of the main verb",
        "example": "ကျွန်ုပ်၏အိမ်တွင်နေချင်သလောက် သင်နေနိုင်ပါသည်။",
        "reference": "§122(ဇ)"
      },
      {
        "id": "CT_AVC_09",
        "subtype": "အမူအရာပြကြိယာဝိသေသနဝါကျကဏ္ဍ",
        "description": "အမူအရာကို ဖော်ပြခြင်းဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သောအမှီဝါကျကဏ္ဍ",
        "ending_markers": ["လျက်", "ကာ"],
        "function": "manner modification of the main verb",
        "example": "ကလေးများသည် ခုန်ပေါက်လျက် ကျောင်းမှပြန်လာကြသည်။",
        "reference": "§122(ဈ)"
      }
    ]
  },
  "sentence_classification": {
    "by_meaning": {
      "declarative": [
        {
          "id": "SCD_01",
          "pattern": "SUBJ + [OBJ/ADV] + VERB + TENSE_PARTICLE",
          "particles": ["သည်", "၏", "မည်", "လတ္တံ့", "အံ့"],
          "particle_count": 1,
          "tense_distinction": {
            "present_state": ["သည်", "၏"],
            "future_state": ["မည်", "လတ္တံ့", "အံ့"],
            "description": "သည်/၏ ဆက်လိုက်သောအခါ ကတ္တား၏ ပြုသည်၊ ဖြစ်သည်၊ ရှိသည်၏ အဖြစ်ကိုပြ၍ မည်/လတ္တံ့/အံ့ ဆက်လိုက်သောအခါ ကတ္တား၏ ပြုမည့်၊ ဖြစ်မည့်၊ ရှိမည့် အဖြစ်ကိုပြသည်"
          },
          "examples": [
            "တပ်မတော်သားတို့သည် နိုင်ငံအတွက် အသက်ကို ပေးလှူကြသည်။",
            "ဆန်စပါးသည် မြန်မာ့ထွက်ကုန်များအနက် အဓိကထွက်ကုန်တစ်ခုဖြစ်၏။",
            "မန္တလေးမြို့၌ မြို့ရိုးနှင့်ကျုံးရှိသည်။",
            "ဤအခန်း၌ ဝါကျအကြောင်းကို အကျယ်ဖော်ပြပါမည်။",
            "ဤသူငယ်သည် ဉာဏ်ပညာကြီးလတ္တံ့။",
            "ဤအမှုကို ပြုလျှင် အကျိုးရှိအံ့။"
          ],
          "reference": "§120"
        }
      ],
      "interrogative": [
        {
          "id": "SCI_01",
          "pattern": "SUBJ + [WH_WORD] + [OBJ] + VERB + Q_PARTICLE",
          "particles": ["နည်း", "လဲ", "တုံး", "လား", "လော"],
          "wh_words": ["ဘယ်သူ", "မည်သူ", "ဘယ်", "မည်မျှ", "ဘယ်နှယောက်", "ဘယ်တော့", "မည်သည့်"],
          "particle_count": 1,
          "wh_particle_pairing": {
            "rule": "အမေးပစ္စည်းများကို ကြိယာနှင့်ဆက်၍ အမေးဝါကျရိုးဖွဲ့သောအခါ အမေးနာမ်စား၊ အမေးနာမဝိသေသသန၊ အမေးကြိယာဝိသေသနတစ်ခုခုနှင့် တွဲဖက်ဖွဲ့စည်း",
            "interchangeable_groups": [
              {"group": "နည်း/လဲ/တုံး", "description": "အလဲအလှယ်ပြု၍ သုံးနိုင်သော အမေးပစ္စည်းများ", "examples": ["အမေဘယ်သွားသနည်း။", "အမေဘယ်သွားသလဲ။", "အမေဘယ်သွားသတုံး။"]},
              {"group": "လား/လော", "description": "အလဲအလှယ်ပြု၍ သုံးနိုင်သော အမေးပစ္စည်းများ", "examples": ["မောင်မောင်ပထမရသလား။", "မောင်မောင်ပထမရသလော။"]}
            ]
          },
          "examples": [
            "အမေ ဘယ် သွားသနည်း။",
            "အမေ ဘာ ဝယ်လာသလဲ။",
            "ဘုရားကို ဘယ်သူ နဲ့ သွားသတုံး။",
            "ကျောင်းသား မည်မျှ စာမေးပွဲအောင်သနည်း။",
            "အမေ ဘာ ဟင်းချက်သလဲ။",
            "ဘယ် မုန့်ကို ပိုကြိုက်သတုံး။",
            "သူ ဘာကြောင့် မလာသနည်း။",
            "စကားကို ဘယ်လို ပြောသင့်သလဲ။",
            "သူ့အကြောင်းကို မင်း ဘယ်လောက် သိသတုံး။"
          ],
          "reference": "§134, §136, §137"
        },
        {
          "id": "SCI_02",
          "pattern": "SUBJ + [OBJ] + VERB + Q_PARTICLE",
          "particles": ["လား", "လော"],
          "particle_count": 1,
          "examples": [
            "စာမေးပွဲအောင်သလား။",
            "အဖေတို့ ပြန်ရောက်ကြပြီလား။",
            "သူကျောင်းမသွားဘူးလား။"
          ],
          "reference": "§137"
        },
        {
          "id": "SCI_03",
          "pattern": "SUBJ + WH_PRONOUN + ELLIPTICAL_VERB + Q_PARTICLE",
          "description": "ကြိယာမြှုပ်၍ဖွဲ့သော အမေးဝါကျရိုး",
          "particles": ["နည်း", "လဲ", "တုံး"],
          "examples": [
            "အမေးဝါကျဟူသည် အဘယ်နည်း။",
            "မောင်မောင် ဘယ် မှာ ဘယ် လဲ။",
            "ဟဲ့ ဘယ်တုံး ဘယ်တုံး။",
            "ဤကျောင်း၌ ကျောင်းသား မည်မျှနည်း။",
            "အဲဒါ ဘာ ပန်း ဘာ လဲ။",
            "အဲဒါ ဘာ စာအုပ် ဘာ တုံး။"
          ],
          "reference": "§135"
        }
      ],
      "negative": [
        {
          "id": "SCN_01",
          "pattern": "SUBJ + [OBJ/ADV] + NEG + VERB + END_PARTICLE",
          "particles": ["မ", "ဘူး", "ချေ", "ပါ", "နဲ့", "နှင့်", "ပေါင်", "ဘဲ", "ဘဲကို"],
          "particle_count": 2,
          "example": "မောင်မောင်ကျောင်းမှ ပြန်မလာပါ။",
          "reference": "§129"
        },
        {
          "id": "SCN_02",
          "pattern": "SUBJ + [OBJ/ADV] + NEG + VERB + AUX + END_PARTICLE",
          "particles": ["မ", "နိုင်", "ရ", "စေရ", "ဘူး"],
          "particle_count": 3,
          "example": "မောင်မောင်ကို ဘယ်မှာမျှ ရှာမတွေ့ဘူး။",
          "reference": "§129"
        },
        {
          "id": "SCN_03",
          "pattern": "NEG + VERB + NEG_PARTICLE",
          "description": "အငြင်းပြပစ္စည်း မ ဆက်လျှင် အငြင်းဝါကျဖြစ်လာသည်။ ကြိယာပုဒ်၏နောက်၌ အခြားဆီလျော်သောပစ္စည်းများကို ဆက်နိုင်သည်။",
          "negation_structure": {
            "pre_verb": ["မ"],
            "post_verb_groups": {
              "group_1_bu": {
                "particles": ["ဘူး"],
                "insertable_between_verb_and_bu": ["ကွယ်", "နော်", "ပါ", "သေး", "တော့"],
                "insertable_after_bu": ["ကွာ", "နော်"],
                "examples": [
                  "မ + (ကြိယာ) + ဘူး",
                  "မ + (ကြိယာ) + ကွယ် + ဘူး",
                  "မ + (ကြိယာ) + ဘူး + ကွာ"
                ]
              },
              "group_2_ne": {
                "particles": ["နဲ့", "နှင့်"],
                "insertable_after": ["လေ", "ကွယ်", "ကွာ", "အုံး", "တော့", "နော်"],
                "insertable_between_verb_and_ne": ["ပါစေ", "ပါရစေ"],
                "examples": [
                  "မ + (ကြိယာ) + နဲ့ + လေ",
                  "မ + (ကြိယာ) + ပါစေ + နဲ့"
                ]
              },
              "group_3_pang": {
                "particles": ["ပေါင်", "ဘဲ", "ဘဲကို"],
                "insertable_between_verb_and_pang": ["သေး", "နိုင်"],
                "examples": [
                  "မ + (ကြိယာ) + နိုင် + ပေါင်",
                  "မ + (ကြိယာ) + သေး + ဘဲကို"
                ]
              }
            }
          },
          "examples": [
            "မ + (ကြိယာ) + ဘူး",
            "မ + (ကြိယာ) + နဲ့ + ကွယ်",
            "မ + (ကြိယာ) + ပါစေ + နဲ့",
            "မ + (ကြိယာ) + နိုင် + ပေါင်"
          ],
          "reference": "§129-§133"
        }
      ],
      "imperative": [
        {
          "id": "SCI_04",
          "pattern": "VERB + IMP_PARTICLE",
          "particles": ["လော့", "ပါလော့", "စို့", "ကြစို့", "ရအောင်", "ပါစေ", "စေ", "နော်", "ကွယ်", "ပါလား"],
          "particle_count": 1,
          "subtypes": {
            "command_strong": {
              "particles": ["လော့", "ပါလော့"],
              "description": "စေခိုင်းခြင်း၊ တိုက်တွန်းခြင်း၊ နှိုးဆော်ခြင်းကိုပို၍ထင်ရှားစေ",
              "examples": ["သွားလော့။", "သွားပါလော့။"]
            },
            "request_soft": {
              "particles": ["နော်", "ကွယ်", "ပါလား", "နှင့်ပါလား"],
              "description": "တိုက်တွန်းခြင်း၊ နှိုးဆော်ခြင်း",
              "examples": ["သွားနော်။", "သွားကွယ်။", "သွားပါလား။", "သွားနှင့်ပါလား။"]
            },
            "hortative": {
              "particles": ["စို့", "ကြစို့", "ရအောင်"],
              "description": "အတူတကွဆောင်ရွက်ခြင်း၊ နှိုးဆော်ခြင်း",
              "examples": ["သွားစို့။", "အိမ်ပြန် ကြစို့။", "ငါတို့ စုပေါင်းလုပ်အားပေး ရအောင်။"]
            }
          },
          "examples": [
            "သွား လော့။",
            "သွား ပါလော့။",
            "သွား နော်။",
            "သွား ကွယ်။",
            "သွား ပါလား။",
            "သွား နှင့်ပါလား။"
          ],
          "reference": "§122, §123"
        },
        {
          "id": "SCI_05",
          "pattern": "SUBJ + VERB + IMP_PARTICLE",
          "particles": ["ကြလော့", "ပါရစေ"],
          "particle_count": 1,
          "example": "တိုင်းရင်းသားအချင်းချင်း သွေးစည်းညီညွတ်ကြလော့။",
          "reference": "§122"
        },
        {
          "id": "SCI_06",
          "pattern": "VERB (zero particle)",
          "description": "ဝိဘတ်ပစ္စည်းမဆက်စေကာမူ အမိန့်ပေးခြင်း၊ စေခိုင်းခြင်းကိုပြသောဝါကျများ",
          "particles": [],
          "particle_count": 0,
          "examples": [
            "အတွင်းဝန်မှစ၍ သင်းစုပင်းစုစာရင်းကိုလည်း သွင်း။",
            "ရှေးစီရင်ထုံးနှင့်အညီ ကွပ်ညှပ်စီရင်။",
            "ဒိုင်းခေါင်းအဝှန်း ထောင်ကဲပဲ့နင်းတို့ကို မြေနန်းတော်တွင် သစ္စာတော်ပေး။"
          ],
          "reference": "§121"
        }
      ],
      "optative": [
        {
          "id": "SCO_01",
          "pattern": "SUBJ + [OBJ] + VERB + OPT_PARTICLE",
          "particles": ["ပါစေ", "စေသတည်း", "ရစေရဲ့"],
          "particle_count": 1,
          "example": "လာမည့်ဘေး ဝေးပါစေသော်။",
          "reference": "§124"
        },
        {
          "id": "SCO_02",
          "pattern": "VERB + ပါစေ",
          "description": "ကြိယာ၏သတ္တိကိုလိုက်၍ တောင့်တခြင်း၊ ကျိန်ဆဲခြင်း၊ ခွင့်ပြုခြင်း",
          "meanings": [
            {"type": "wish", "example": "သတ္တဝါအပေါင်း ကျန်းမာပါစေ။", "description": "တောင့်တခြင်း"},
            {"type": "curse", "example": "သွားလေရာ ဘေးတွေ့ပါစေ။", "description": "ကျိန်ဆဲခြင်း"},
            {"type": "permission", "example": "ကလေးများ ကစားပါစေ။", "description": "ခွင့်ပြုခြင်း"}
          ],
          "reference": "§124"
        },
        {
          "id": "SCO_03",
          "pattern": "VERB + ပါရစေ",
          "description": "ခွင့်တောင်းခြင်းကိုပြသော ဝါကျများ",
          "examples": [
            "စကားတစ်ခွန်းလောက် ပြောပါရစေ။",
            "ရေလေးတစ်ပေါက်လောက် သောက်ပါရစေ။",
            "ဒီနေရာမှာ ခေတ္တထိုင် ပါရစေ။"
          ],
          "reference": "§125"
        },
        {
          "id": "SCO_04",
          "pattern": "VERB + စေ",
          "description": "အမိန့်ပေးခြင်း၊ စေခိုင်းခြင်းကို ပြသော ဝါကျများ",
          "examples": [
            "ရာဇဒဏ်ဆယ်ချက်ခတ်၍ လွှတ်စေ။",
            "ဆိုးမြီကောင်းမွေကို မယားက ရစေ။",
            "ကျမ်းသစ္စာတော်နှင့် အစစ်ခံစေ။"
          ],
          "reference": "§126"
        }
      ],
      "verb_particle_taxonomy_summary": {
        "description": "ကြိယာပုဒ်တွင် ဆက်သောဝိဘတ်များကိုလိုက်၍ ဝါကျအမျိုးအစား ကွဲပြားသွားသည်",
        "categories": [
          {"type": "declarative", "particles": ["သည်", "၏", "မည်", "လတ္တံ့", "အံ့"], "function": "တစ်စုံတစ်ရာ ပြုခြင်း၊ ဖြစ်ခြင်း၊ ရှိခြင်းကို ပြသောဝါကျ"},
          {"type": "imperative", "particles": ["လော့", "ပါလော့", "နော်", "ကွယ်", "ပါလား", "စေ"], "function": "အမိန့်ပေးခြင်း၊ စေခိုင်းခြင်း၊ တိုက်တွန်းခြင်း၊ နှိုးဆော်ခြင်း"},
          {"type": "hortative", "particles": ["စို့", "ကြစို့", "ရအောင်"], "function": "အတူတကွ ဆောင်ရွက်လိုခြင်း"},
          {"type": "optative", "particles": ["ပါစေ", "ပါရစေ"], "function": "တောင့်တခြင်း၊ ကျိန်ဆဲခြင်း၊ ခွင့်ပြုခြင်း၊ ခွင့်တောင်းခြင်း"}
        ],
        "reference": "§127"
      },
      "particle_stacking": {
        "description": "ဝိဘတ်ဆက်ပြီးနောက် အကြောင်းအားလျော်စွာ ပစ္စည်းကိုလည်း ဆက်နိုင်သည်။ ဝါကျ၏အနက်အဓိပ္ပာယ်သည် ပစ္စည်းကိုလိုက်၍ ကွာခြားသွားသည်။",
        "examples": [
          {"base": "သွားစို့", "stacked": "သွားကြစို့", "added": "ကြ"},
          {"base": "သွားကြစို့", "stacked": "သွားကြပါစို့", "added": "ပါ"},
          {"base": "သွားကြပါစို့", "stacked": "သွားကြပါစို့ကွယ်", "added": "ကွယ်"},
          {"base": "သွားကြပါစို့", "stacked": "သွားကြပါစို့ကွာ", "added": "ကွာ"},
          {"base": "သွားစို့", "stacked": "သွားစို့လေ", "added": "လေ"},
          {"base": "သွားစို့", "stacked": "သွားကြရအောင်ကွာ", "added": "ရအောင်+ကွာ"}
        ],
        "reference": "§128"
      }
    },
    "by_structure": {
      "simple": [
        {"pattern": "SUBJ + VERB", "min_elements": ["SUBJ", "VERB"], "particle_count": 0, "example": "သူ ပြန်လာသည်။"}
      ],
      "complex": [
        {"pattern": "CLAUSE_A + CONNECTOR + CLAUSE_B", "min_elements": ["CLAUSE", "CLAUSE", "CONNECTOR"], "particle_count": 1, "example": "မောင်မောင်ပြန်လာသည်ကို ကျွန်တော်မြင်သည်။"}
      ]
    }
  },
  "simple_sentence_patterns": [
    {"id": "SP_01", "pattern": "SUBJ + VERB", "elements": ["SUBJ", "VERB"], "particles": [], "particle_count": 0, "example": "သူ ပြန်လာသည်။", "reference": "§63(က), §112"},
    {"id": "SP_02", "pattern": "SUBJ + SUBJ_COMPLEMENT + VERB", "elements": ["SUBJ", "SUBJ_COMPLEMENT", "VERB"], "particles": [], "particle_count": 0, "example": "မောင်ဘသည် ကျောင်းသား ဖြစ်သည်။", "reference": "§63(ခ)"},
    {"id": "SP_03", "pattern": "SUBJ + OBJ + VERB", "elements": ["SUBJ", "OBJ", "VERB"], "particles": ["ကို"], "particle_count": 1, "example": "မောင်မောင်သည် မိဘကို ကူညီသည်။", "reference": "§63(ဂ)"},
    {"id": "SP_04", "pattern": "SUBJ + OBJ + OBJ_COMPLEMENT + VERB", "elements": ["SUBJ", "OBJ", "OBJ_COMPLEMENT", "VERB"], "particles": ["ကို"], "particle_count": 1, "example": "မောင်မောင်သည် ရွှေကို လက်ကောက် လုပ်သည်။", "reference": "§63(ဃ)"},
    {"id": "SP_05", "pattern": "SUBJ + SOURCE + VERB", "elements": ["SUBJ", "SOURCE", "VERB"], "particles": ["မှ"], "particle_count": 1, "example": "မောင်မောင် ကျောင်းမှ ပြန်လာသည်။", "reference": "§63(င)"},
    {"id": "SP_06", "pattern": "SUBJ + GOAL + VERB", "elements": ["SUBJ", "GOAL", "VERB"], "particles": ["သို့"], "particle_count": 1, "example": "မောင်မောင်သည် အိမ်သို့ ပြန်လာသည်။", "reference": "§63(စ)"},
    {"id": "SP_07", "pattern": "SUBJ + DESTINATION + VERB", "elements": ["SUBJ", "DESTINATION", "VERB"], "particles": ["အထိ", "ထိ", "ထိအောင်"], "particle_count": 1, "example": "တောင်တက်သမားတို့သည် တောင်ထိပ်အထိ တက်ကြသည်။", "reference": "§63(ဆ)"},
    {"id": "SP_08", "pattern": "SUBJ + OBJ + INSTRUMENT + VERB", "elements": ["SUBJ", "OBJ", "INSTRUMENT", "VERB"], "particles": ["ကို", "ဖြင့်"], "particle_count": 2, "example": "မောင်မောင်သည် ဆရာကို စာအုပ်ဖြင့် ကန်တော့သည်။", "reference": "§63(ဇ)"},
    {"id": "SP_09", "pattern": "SUBJ + CAUSE + VERB", "elements": ["SUBJ", "CAUSE", "VERB"], "particles": ["ကြောင့်"], "particle_count": 1, "example": "စပါးပင်တို့သည် ပိုးကြောင့် ပျက်ကုန်၏။", "reference": "§63(ဈ)"},
    {"id": "SP_10", "pattern": "SUBJ + OBJ + RECIPIENT + VERB", "elements": ["SUBJ", "OBJ", "RECIPIENT", "VERB"], "particles": ["ကို", "အား"], "particle_count": 2, "example": "မောင်မောင်သည် စာအုပ်ကို ဆရာအား ပေးသည်။", "reference": "§63(ည)"},
    {"id": "SP_11", "pattern": "SUBJ + LOCATION + VERB", "elements": ["SUBJ", "LOCATION", "VERB"], "particles": ["၌", "တွင်", "မှာ"], "particle_count": 1, "example": "ငါးသည် ရေ၌ ပျော်၏။", "reference": "§63(ဋ)"},
    {"id": "SP_12", "pattern": "SUBJ + TIME + VERB", "elements": ["SUBJ", "TIME", "VERB"], "particles": ["၌", "တွင်", "က"], "particle_count": 1, "example": "သစ်ရွက်တို့သည် တပေါင်းလ၌ ကြွေသည်။", "reference": "§63(ဌ)"},
    {"id": "SP_13", "pattern": "SUBJ + POSSESSION + SUBJ_COMPLEMENT + VERB", "elements": ["SUBJ", "POSSESSION", "SUBJ_COMPLEMENT", "VERB"], "particles": ["၏"], "particle_count": 1, "example": "ဤစာအုပ်သည် မောင်ဘ၏ စာအုပ် ဖြစ်သည်။", "reference": "§63(ဍ)"},
    {"id": "SP_14", "pattern": "SUBJ + OBJ + SOURCE + VERB", "elements": ["SUBJ", "OBJ", "SOURCE", "VERB"], "particles": ["ကို", "မှ"], "particle_count": 2, "example": "အမေသည် မောင်မောင်ကို ကျောင်းမှ ခေါ်လာသည်။", "reference": "§63(ဎ)"},
    {"id": "SP_15", "pattern": "SUBJ + OBJ + GOAL + VERB", "elements": ["SUBJ", "OBJ", "GOAL", "VERB"], "particles": ["ကို", "သို့"], "particle_count": 2, "example": "သူသည် စာအုပ်ကို အိမ်သို့ ယူသွားသည်။", "reference": "§63(ဏ)"},
    {"id": "SP_16", "pattern": "SUBJ + SOURCE + GOAL + VERB", "elements": ["SUBJ", "SOURCE", "GOAL", "VERB"], "particles": ["မှ", "သို့"], "particle_count": 2, "example": "မောင်ဘသည် ကျောင်းမှ အိမ်သို့ ပြန်လာသည်။", "reference": "§63(တ)"},
    {"id": "SP_17", "pattern": "SUBJ + OBJ + LOCATION + VERB", "elements": ["SUBJ", "OBJ", "LOCATION", "VERB"], "particles": ["ကို", "၌"], "particle_count": 2, "example": "ဆရာသည် မောင်ဘကို အတန်းထဲ၌ ချီးကျူးသည်။", "reference": "§63(ထ)"},
    {"id": "SP_18", "pattern": "SUBJ + OBJ + TIME + VERB", "elements": ["SUBJ", "OBJ", "TIME", "VERB"], "particles": ["ကို", "၌"], "particle_count": 2, "example": "သူသည် ညစာကို ၅ နာရီ၌ စားသည်။", "reference": "§63(ဒ)"},
    {"id": "SP_19", "pattern": "SUBJ + SOURCE + GOAL + TIME + VERB", "elements": ["SUBJ", "SOURCE", "GOAL", "TIME", "VERB"], "particles": ["မှ", "သို့", "က"], "particle_count": 3, "example": "မောင်ဘသည် ကျောင်းမှ အိမ်သို့ ညနေက ပြန်လာသည်။", "reference": "§63(ဓ)"},
    {"id": "SP_20", "pattern": "SUBJ + OBJ + LOCATION + TIME + VERB", "elements": ["SUBJ", "OBJ", "LOCATION", "TIME", "VERB"], "particles": ["ကို", "၌", "က"], "particle_count": 3, "example": "တရားသူကြီးသည် ခိုးမှုကို တရားရုံး၌ နံနက်က စစ်ဆေးသည်။", "reference": "§63(န)"},
    {"id": "SP_21", "pattern": "SUBJ + ADJ + LOCATION + ADV + VERB", "elements": ["SUBJ", "ADJ", "LOCATION", "ADV", "VERB"], "particles": [], "particle_count": 0, "example": "လသည် ကြည်လင်သော ကောင်းကင်၌ ရွှန်းရွှန်းပပ သာနေသည်။", "reference": "§182(က)"},
    {"id": "SP_22", "pattern": "ADJ + SUBJ + ADJ + OBJ + ADV + VERB", "elements": ["ADJ", "SUBJ", "ADJ", "OBJ", "ADV", "VERB"], "particles": [], "particle_count": 0, "example": "တာဝန်သိသော ရွာသားများသည် ပျက်စီးနေသော လမ်းကို အင်တိုက်အားတိုက် ပြင်ကြသည်။", "reference": "§182(ခ)"},
    {"id": "SP_23", "pattern": "NOUN_PHRASE + LOCATION + VERB", "elements": ["NOUN_PHRASE", "LOCATION", "VERB"], "particles": [], "particle_count": 0, "example": "ဦးဘ၏သားသည် ရန်ကုန်မြို့၌ နေသည်။", "reference": "§183(က)"},
    {"id": "SP_24", "pattern": "SUBJ + OBJ + LOCATION_PHRASE + VERB", "elements": ["SUBJ", "OBJ", "LOCATION_PHRASE", "VERB"], "particles": [], "particle_count": 0, "example": "ကျွန်တော်သည် အချိန်စာရင်းကို မှတ်စုစာအုပ်တွင် ကူးယူမှတ်သားထားသည်။", "reference": "§183(ခ)"},
    {"id": "SP_25", "pattern": "SUBJ + TIME_PHRASE + VERB", "elements": ["SUBJ", "TIME_PHRASE", "VERB"], "particles": [], "particle_count": 0, "example": "မိန်းကလေးများသည် လသာသောညတွင် ထုပ်ဆီးတိုးကြသည်။", "reference": "§183(ဂ)"},
    {"id": "SP_26", "pattern": "SUBJ + OBJ + INSTRUMENT_PHRASE + VERB", "elements": ["SUBJ", "OBJ", "INSTRUMENT_PHRASE", "VERB"], "particles": [], "particle_count": 0, "example": "ရွာသားများသည် ကျွန်တော်တို့ကို ကျောက်ပန်းတောင်းက ထန်းလျက်ဖြင့် ဧည့်ခံကြသည်။", "reference": "§183(ဃ)"},
    {"id": "SP_27", "pattern": "FRONTED_CAUSE + SUBJ + OBJ + VERB", "elements": ["CAUSE", "SUBJ", "OBJ", "VERB"], "particles": ["ကြောင့်"], "particle_count": 1, "example": "လုံ့လကြောင့် မဟာဇနကသည် ထီးနန်းကို ရသည်။", "reference": "§184(က)(၂)"},
    {"id": "SP_28", "pattern": "FRONTED_OBJ + SUBJ + RECIPIENT + VERB", "elements": ["OBJ", "SUBJ", "RECIPIENT", "VERB"], "particles": ["ကို", "အား"], "particle_count": 2, "example": "ဆေးကို ဆရာဝန်သည် လူနာအား ပေးသည်။", "reference": "§184(ခ)(၂)"},
    {"id": "SP_29", "pattern": "FRONTED_LOCATION + SUBJ + VERB", "elements": ["LOCATION", "SUBJ", "VERB"], "particles": ["၌"], "particle_count": 1, "example": "ရန်ကုန်၌ သူ(သည်) နေသည်။", "reference": "§184(ဂ)(၂)"},
    {"id": "SP_30", "pattern": "ELLIPTICAL_SUBJ + OBJ + LOCATION + VERB", "elements": ["(SUBJ)", "OBJ", "LOCATION", "VERB"], "particles": ["ကို", "၌"], "particle_count": 2, "example": "( ) အဝတ်ကို ကန်ပေါင်ပေါ်၌ မလျှော်ရ။", "reference": "§185(က)"},
    {"id": "SP_31", "pattern": "ELLIPTICAL_SUBJ + VERB", "elements": ["(SUBJ)", "VERB"], "particles": [], "particle_count": 0, "example": "( ) သွားကြစို့။", "reference": "§185(ခ)"},
    {"id": "SP_32", "pattern": "ELLIPTICAL_SUBJ + LOCATION + VERB", "elements": ["(SUBJ)", "LOCATION", "VERB"], "particles": [], "particle_count": 0, "example": "( ) ဘယ်မှာ နေသလဲ။", "reference": "§185(ဂ)"},
    {"id": "SP_33", "pattern": "SUBJ + SUBJ_COMP + ELLIPTICAL_VERB + PARTICLE", "elements": ["SUBJ", "SUBJ_COMPLEMENT", "(VERB)", "PARTICLE"], "particles": [], "particle_count": 0, "example": "သူကား ပညာရှိ ( ) တည်း။", "reference": "§186(က)(၁)"},
    {"id": "SP_34", "pattern": "SUBJ + LOCATION + ELLIPTICAL_VERB + PARTICLE", "elements": ["SUBJ", "LOCATION", "(VERB)", "PARTICLE"], "particles": [], "particle_count": 0, "example": "ကျွန်တော်က ရန်ကုန်က ( ) ပါ။", "reference": "§186(ခ)(၁)"},
    {"id": "SP_35", "pattern": "SUBJ + INTERROGATIVE_PRONOUN + ELLIPTICAL_VERB + PARTICLE", "elements": ["SUBJ", "WH_PRONOUN", "(VERB)", "PARTICLE"], "particles": [], "particle_count": 0, "example": "သင်ကား မည်သူ ( ) နည်း။", "reference": "§186(ဂ)(၁)"},
    {"id": "SP_36", "pattern": "SUBJ + ELLIPTICAL_VERB + INTERROGATIVE_PARTICLE", "elements": ["SUBJ", "(VERB)", "INTERROG_PARTICLE"], "particles": [], "particle_count": 0, "example": "သူ ( ) လား။", "reference": "§186(ဃ)(၁)"},
    {"id": "SP_37", "pattern": "OBJ + ELLIPTICAL_VERB + PARTICLE", "elements": ["OBJ", "(VERB)", "PARTICLE"], "particles": [], "particle_count": 0, "example": "သူ့ကို ( ) ပေါ့။", "reference": "§186(ဃ)(၂)"},
    {"id": "SP_38", "pattern": "CAUSE + ELLIPTICAL_VERB + PARTICLE", "elements": ["CAUSE", "(VERB)", "PARTICLE"], "particles": [], "particle_count": 0, "example": "မိုးကြောင့် ( ) ပေါ့။", "reference": "§186(ဃ)(၃)"},
    {"id": "SP_39", "pattern": "SUBJ (opt particle) + VERB", "elements": ["SUBJ", "VERB"], "particles": ["သည် (optional)"], "particle_count": 0, "example": "သူ (သည်) ပြေးသည်။", "reference": "§187(က)"},
    {"id": "SP_40", "pattern": "TIME + SUBJ (opt particle) + VERB", "elements": ["TIME", "SUBJ", "VERB"], "particles": ["သည် (optional)"], "particle_count": 0, "example": "သောကြာနေ့၌ ကျွန်တော်�ို့(သည်) လာကြမည်။", "reference": "§187(ခ)(၂)"},
    {"id": "SP_41", "pattern": "SUBJ + OBJ (opt particle) + VERB", "elements": ["SUBJ", "OBJ", "VERB"], "particles": ["ကို (optional)"], "particle_count": 0, "example": "သူသည် သတင်းစာ(ကို) ဖတ်နေသည်။", "reference": "§188(က)"},
    {"id": "SP_42", "pattern": "SUBJ + OBJ (opt particle) + VERB (plural)", "elements": ["SUBJ", "OBJ", "VERB"], "particles": ["ကို (optional)"], "particle_count": 0, "example": "ရွာသားများသည် လမ်း(ကို) ပြင်ကြသည်။", "reference": "§188(ခ)"}
  ],
  "complex_sentence_connection": {
    "particle": [
      {"connector": "ကို", "type": "OBJ_PARTICLE", "example": "မောင်မောင်ပြန်လာသည်ကို ကျွန်တော်မြင်သည်။"},
      {"connector": "မှာ", "type": "SUBJ_PARTICLE", "example": "မောင်မောင်ဂုဏ်ထူးရမည်မှာ သေချာသည်။"},
      {"connector": "က", "type": "SUBJ_PARTICLE", "example": "မောင်မောင်ပထမရသည်က များသည်။"}
    ],
    "paccaya": [
      {"connector": "ဟု", "type": "QUOTATIVE", "example": "မောင်မောင်ပထမရသည်ဟု ဆရာက တပည့်များကို ပြောသည်။"},
      {"connector": "သော", "type": "ADJECTIVAL", "example": "ကျောင်းမှပြန်လာသော မောင်မောင့်ကို ကျွန်တော်တွေ့သည်။"}
    ],
    "thanbanda": [
      {"connector": "သောအခါ", "type": "TEMPORAL", "example": "ဆရာဝင်လာသောအခါ ကျောင်းသားများ မတ်တတ်ရပ်ကြသည်။"},
      {"connector": "သောကြောင့်", "type": "CAUSAL", "example": "မောင်မောင်ကြိုးစားသောကြောင့် ဂုဏ်ထူးရသည်။"}
    ]
  },
  "word_order_constraints": [
    {"id": "WOC_01", "constraint": "subject_initial_default", "description": "ကတ္တားကို ဝါကျ၏အစ၌ ထားလေ့ရှိသည်", "rule": "SUBJ must appear at the beginning of the sentence by default", "example_correct": "မောင်ညိုလှသည် သတင်းစာကို ဖတ်သည်။", "example_incorrect": null, "reference": "§207(က)"},
    {"id": "WOC_02", "constraint": "subject_preverbal", "description": "ကတ္တားကို ကြိယာ၏ရှေ့၌ ကပ်လျက်ထားလေ့ရှိသည်", "rule": "SUBJ must immediately precede the main verb when no modifiers intervene", "example_correct": "သတင်းစာကို မောင်ညိုလှ ဖတ်သည်။", "example_incorrect": null, "reference": "§207(က)"},
    {"id": "WOC_03", "constraint": "subject_verb_proximity_complex", "description": "အခြားပုဒ်များကြောင့် ကြိယာနှင့် ကွာလှမ်းသောအခါ ကတ္တားကို ကြိယာနှင့် နီးကပ်စွာထားရသည်", "rule": "When modifiers intervene, SUBJ must be placed adjacent to its governing verb to prevent misattachment", "example_correct": "တစ်နှစ်ပတ်လုံး မှန်မှန်ကြိုးစားသောကြောင့် စာမေးပွဲကို ဂုဏ်ထူးဖြင့် အောင်မြင်သည့် မောင်မောင်ကို ဆရာကြီးက ချီးကျူးသည်။", "example_incorrect": "ဆရာကြီးက တစ်နှစ်ပတ်လုံး မှန်မှန်ကြိုးစားသောကြောင့် စာမေးပွဲကို ဂုဏ်ထူးဖြင့် အောင်မြင်သည့် မောင်မောင်ကို ချီးကျူးသည်။", "reference": "§207(ခ)(၁)"},
    {"id": "WOC_04", "constraint": "subject_verb_proximity_injury", "description": "ကြိယာနှင့် ကွာလှမ်းလျှင် ဆိုလိုသည့်အဓိပ္ပာယ် လွဲမှားသွားတတ်သည်", "rule": "SUBJ separated from its verb may attach to an intervening verb, causing semantic error", "example_correct": "ဘောလုံးကန်၍ ခြေထောက်နာနေသဖြင့် ကျောင်းမသွားနိုင်သော မြေးငယ်ကို ဘကြီးက ဆေးလိမ်းပေးသည်။", "example_incorrect": "ဘကြီးက ဘောလုံးကန်၍ ခြေထောက်နာနေသဖြင့် ကျောင်းမသွားနိုင်သော မြေးငယ်ကို ဆေးလိမ်းပေးသည်။", "reference": "§207(ခ)(၂)"},
    {"id": "WOC_05", "constraint": "subject_verb_proximity_admonition", "description": "ဆေးမသောက်သည့်အတွက် ဆရာဝန်ကြီးက သတိပေးရာတွင် ကတ္တားနေရာတကျထားရန်", "rule": "In admonitory sentences, SUBJ must be adjacent to the verb of admonition, not the negated verb", "example_correct": "ဆေးကို မှန်မှန်မသောက်သည့်အတွက် လူနာများ ဆေးကို မှန်မှန်သောက်ကြရန် ဆရာဝန်ကြီးက သတိပေးသည်။", "example_incorrect": "ဆရာဝန်ကြီးက ဆေးကို မှန်မှန်မသောက်သည့်အတွက် လူနာများ ဆေးကို မှန်မှန်သောက်ကြရန် သတိပေးသည်။", "reference": "§207(ခ)(၃)"},
    {"id": "WOC_06", "constraint": "adjective_pre_noun", "description": "သော ပစ္စည်းပါသည့် နာမဝိသေသနကို အထူးပြုခံရမည့် နာမ်၏ရှေ့တွင် ကပ်ထားရသည်", "rule": "Adjectives with သောပစ္စည်း must immediately precede the noun they modify", "example_correct": "ဆရာသည် လိမ်မာသော တပည့်ကို ချစ်သည်။", "example_incorrect": null, "reference": "§208(က)"},
    {"id": "WOC_07", "constraint": "adjective_phrase_pre_noun", "description": "နာမဝိသေသနအဖြစ်သုံးသည့် နေရာပြပုဒ်များကို အထူးပြုခံနာမ်၏ရှေ့တွင် ကပ်ထားရသည်", "rule": "Adjectival locative phrases must precede the head noun", "example_correct": "ကလေးများရေကူးရန် ပေ ၂၀ ရှည်သော ကန်တစ်ခုကို အမြန်တူးနေသည်။", "example_incorrect": "ပေ ၂၀ ရှည်သော ကလေးများရေကူးရန် ကန်တစ်ခုကို အမြန်တူးနေသည်။", "reference": "§208(ခ)(၁)"},
    {"id": "WOC_08", "constraint": "relative_clause_pre_noun", "description": "သော/သည့် ပစ္စည်းပါသော နာမဝိသေသနနှင့် နေရာပြပုဒ်တို့ကို အထူးပြုခံနာမ်၏ရှေ့တွင် ကပ်ထားရသည်", "rule": "Relative clauses with သောပစ္စည်း must precede the head noun", "example_correct": "ကြောင်အိမ်ထဲက ငါးကြော်တစ်ကောင်ကို ပေးလိုက်ပါသည်။", "example_incorrect": "ငါးကြော်တစ်ကောင်ကို ကြောင်အိမ်ထဲက ပေးလိုက်ပါသည်။", "reference": "§208(ခ)(၂)"},
    {"id": "WOC_09", "constraint": "ordinal_numeral_pre_noun", "description": "အစဉ်ပြသင်္ချာနာမဝိသေသနတို့ကို အထူးပြုခံနာမ်၏ရှေ့တွင် ကပ်ထားရသည်", "rule": "Ordinal/numeral modifiers must precede the head noun", "example_correct": "မသန်မစွမ်းသူများ၏ ငါးကြိမ်မြောက် အားကစားပြိုင်ပွဲကို ယနေ့ ကျင်းပသည်။", "example_incorrect": "ငါးကြိမ်မြောက် မသန်မစွမ်းသူများ၏ အားကစားပြိုင်ပွဲကို ယနေ့ ကျင်းပသည်။", "reference": "§208(ခ)(၃)"},
    {"id": "WOC_10", "constraint": "adverb_pre_verb_default", "description": "ကြိယာဝိသေသနကို ကြိယာ၏ရှေ့တွင်ထားလေ့ရှိသည်", "rule": "Adverbs must precede the verb they modify", "example_correct": "သူသည် ဈေးမှ အမြန် ပြန်လာသည်။", "example_incorrect": null, "reference": "§209(က)"},
    {"id": "WOC_11", "constraint": "temporal_adverb_pre_verb", "description": "အချိန်ပြပုဒ်ကို ကြိယာ၏ရှေ့တွင် ကပ်ထားရသည်", "rule": "Temporal adverbs must immediately precede the verb, not the object", "example_correct": "မလှသည် ပေါင်မုန့်ကို မနေ့က စားသည်။", "example_incorrect": "မလှသည် မနေ့က ပေါင်မုန့်ကို စားသည်။", "reference": "§209(ခ)(၁)"},
    {"id": "WOC_12", "constraint": "locative_adverb_pre_verb", "description": "နေရာပြပုဒ်ကို ကြိယာ၏ရှေ့တွင် ကပ်ထားရသည်", "rule": "Locative adverbs must immediately precede the verb", "example_correct": "ကြာပန်းကို လှေပေါ်က ခူးသည်။", "example_incorrect": "လှေပေါ်က ကြာပန်းကို ခူးသည်။", "reference": "§209(ခ)(၂)"},
    {"id": "WOC_13", "constraint": "purpose_locative_adverb_pre_verb", "description": "တွင် ဝိဘတ်ပါသည့် နေရာပြပုဒ်ကို ကြိယာ၏ရှေ့တွင် ကပ်ထားရသည်", "rule": "Purpose/locative adverbial phrases must precede the verb", "example_correct": "လိမ်မပြောရန် တပည့်များကို ဆရာက စာသင်ခန်းတွင် ဆုံးမသည်။", "example_incorrect": "စာသင်ခန်းတွင် လိမ်မပြောရန် တပည့်များကို ဆရာက ဆုံးမသည်။", "reference": "§209(ခ)(၃)"},
    {"id": "WOC_14", "constraint": "instrumental_manner_adverb_pre_verb", "description": "ဖြင့် ဝိဘတ်ပါသည့် အသုံးခံပြပုဒ်နှင့် စွာပစ္စည်းပါသည့် ကြိယာဝိသေသနတို့ကို ကြိယာ၏ရှေ့တွင် ကပ်ထားရသည်", "rule": "Instrumental and manner adverbs must immediately precede the verb", "example_correct": "မောင်ဘက မောင်လှကို တုတ်နှင့် ရိုက်သည်။", "example_incorrect": "မောင်ဘက တုတ်နှင့် မောင်လှကို ရိုက်သည်။", "reference": "§209(ခ)(၄)"}
  ],
  "compound_sentence_patterns": [
    {
      "id": "CSP_01",
      "pattern": "CLAUSE + ကို",
      "description": "ဝါကျရိုးများကို ကံဝိဘတ် 'ကို' နှင့်ဆက်၍ ဝါကျရောဖွဲ့နည်း",
      "connector": "ကို",
      "connector_type": "ဝိဘတ် (ကံဝိဘတ်)",
      "subordinate_function": "object_clause",
      "example": "မောင်မောင်ပြန်လာသည်ကို ကျွန်တော်မြင်သည်။",
      "breakdown": {
        "subordinate_clause": "မောင်မောင်ပြန်လာသည်ကို",
        "main_clause": "ကျွန်တော်မြင်သည်။"
      },
      "reference": "§189(က)(၁)"
    },
    {
      "id": "CSP_02",
      "pattern": "CLAUSE + မှာ",
      "description": "ဝါကျရိုးများကို ကတ္တားဝိဘတ် 'မှာ' နှင့်ဆက်၍ ဝါကျရောဖွဲ့နည်း",
      "connector": "မှာ",
      "connector_type": "ဝိဘတ် (ကတ္တားဝိဘတ်)",
      "subordinate_function": "subject_clause",
      "example": "မောင်မောင် ဂုဏ်ထူးရမည်မှာ သေချာသည်။",
      "breakdown": {
        "subordinate_clause": "မောင်မောင် ဂုဏ်ထူးရမည်မှာ",
        "main_clause": "သေချာသည်။"
      },
      "reference": "§189(က)(၂)"
    },
    {
      "id": "CSP_03",
      "pattern": "CLAUSE + က",
      "description": "ဝါကျရိုးများကို ကတ္တားဝိဘတ် 'က' နှင့်ဆက်၍ ဝါကျရောဖွဲ့နည်း",
      "connector": "က",
      "connector_type": "ဝိဘတ် (ကတ္တားဝိဘတ်)",
      "subordinate_function": "subject_clause",
      "example": "မောင်မောင်ပထမရသည်က များသည်။",
      "breakdown": {
        "subordinate_clause": "မောင်မောင်ပထမရသည်က",
        "main_clause": "များသည်။"
      },
      "reference": "§189(က)(၃)"
    },
    {
      "id": "CSP_04",
      "pattern": "CLAUSE + ဟု",
      "description": "ဝါကျရိုးများကို ပစ္စည်း 'ဟု' နှင့်ဆက်၍ ဝါကျရောဖွဲ့နည်း",
      "connector": "ဟု",
      "connector_type": "ပစ္စည်း",
      "subordinate_function": "quotative_clause",
      "example": "မောင်မောင် ပထမရသည်ဟု ဆရာက တပည့်များကို ပြောသည်။",
      "breakdown": {
        "subordinate_clause": "မောင်မောင် ပထမရသည်ဟု",
        "main_clause": "ဆရာက တပည့်များကို ပြောသည်။"
      },
      "reference": "§189(ခ)(၁)"
    },
    {
      "id": "CSP_05",
      "pattern": "CLAUSE + သော",
      "description": "ဝါကျရိုးများကို ပစ္စည်း 'သော' နှင့်ဆက်၍ ဝါကျရောဖွဲ့နည်း (နာမဝိသေသနဝါကျကဏ္ဍ)",
      "connector": "သော",
      "connector_type": "ပစ္စည်း",
      "subordinate_function": "adjectival_clause",
      "example": "ကျောင်းမှပြန်လာသော မောင်မောင့်ကို ကျွန်တော် တွေ့သည်။",
      "breakdown": {
        "subordinate_clause": "ကျောင်းမှပြန်လာသော",
        "modified_noun": "မောင်မောင့်ကို",
        "main_clause": "ကျွန်တော် တွေ့သည်။"
      },
      "reference": "§189(ခ)(၂)"
    },
    {
      "id": "CSP_06",
      "pattern": "CLAUSE + သောအခါ",
      "description": "ဝါကျရိုးများကို သမ္ဗန္ဓ 'သောအခါ' နှင့်ဆက်၍ ဝါကျရောဖွဲ့နည်း",
      "connector": "သောအခါ",
      "connector_type": "သမ္ဗန္ဓ (အချိန်ပြ)",
      "subordinate_function": "temporal_adverbial_clause",
      "example": "ဆရာဝင်လာသောအခါ ကျောင်းသားများ မတ်တတ် ရပ်ကြသည်။",
      "breakdown": {
        "subordinate_clause": "ဆရာဝင်လာသောအခါ",
        "main_clause": "ကျောင်းသားများ မတ်တတ် ရပ်ကြသည်။"
      },
      "reference": "§189(ဂ)(၁)"
    },
    {
      "id": "CSP_07",
      "pattern": "CLAUSE + သောကြောင့်",
      "description": "ဝါကျရိုးများကို သမ္ဗန္ဓ 'သောကြောင့်' နှင့်ဆက်၍ ဝါကျရောဖွဲ့နည်း",
      "connector": "သောကြောင့်",
      "connector_type": "သမ္ဗန္ဓ (အကြောင်းပြ)",
      "subordinate_function": "causal_adverbial_clause",
      "example": "မောင်မောင်ကြိုးစားသောကြောင့် ဂုဏ်ထူးရသည်။",
      "breakdown": {
        "subordinate_clause": "မောင်မောင်ကြိုးစားသောကြောင့်",
        "main_clause": "ဂုဏ်ထူးရသည်။"
      },
      "reference": "§189(ဂ)(၂)"
    },
    {
      "id": "CSP_08",
      "pattern": "CLAUSE_1 + (connector) + CLAUSE_2 + (connector) + CLAUSE_3",
      "description": "ဝါကျရိုး ၃ ခုထက်ပို၍ပါဝင်သော ဝါကျရောဖွဲ့နည်း (multi-clause embedding)",
      "connector": "various (၍/လျှင်/ကာ/သော်/etc)",
      "connector_type": "သမ္ဗန္ဓ/ပစ္စည်း/ဝိဘတ်",
      "subordinate_function": "multiple_clause_coordination",
      "example": "ဖခင်က မြန်မာ့သူရဲကောင်းများအကြောင်းကိုပြောပြ၍ ကျွန်တော်က သူငယ်ချင်းများကို ပြန်ပြောပြရာ သူငယ်ချင်းများက အလွန်သဘောကျကြပါသည်။",
      "breakdown": {
        "clause_1": "ဖခင်က မြန်မာ့သူရဲကောင်းများအကြောင်းကိုပြောပြ၍",
        "clause_2": "ကျွန်တော်က သူငယ်ချင်းများကို ပြန်ပြောပြရာ",
        "clause_3": "သူငယ်ချင်းများက အလွန်သဘောကျကြပါသည်။"
      },
      "reference": "§193(က)"
    },
    {
      "id": "CSP_09",
      "pattern": "CLAUSE_1 + (connector) + CLAUSE_2 + (connector) + ... + CLAUSE_N",
      "description": "ဝါကျရိုး ၄ ခု/၅ ခု ပါဝင်သော ဝါကျရောဖွဲ့နည်း (deep nesting)",
      "connector": "various (၍/လျှင်/ကာ/သော်/နှင့်တစ်ပြိုင်နက်/etc)",
      "connector_type": "သမ္ဗန္ဓ/ပစ္စည်း/ဝိဘတ်",
      "subordinate_function": "deep_nested_coordination",
      "example": "ဘောလုံးသည် မောင်ချစ်ညို၏ရှေ့သို့ ကျလာသည်နှင့်တစ်ပြိုင်နက် သူသည် ဘောလုံးကို ဂိုးပေါက်ဆီသို့ တစ်ရှိန်ထိုး သယ်သွားကာ ဂိုးဧရိယာအတွင်းသို့ရောက်လျှင် ဂိုးပေါက်ထဲသို့ တအားကုန် ကန်သွင်းလိုက်ရာ တည့်တည့်မတ်မတ် ဝင်သွားသည်။",
      "breakdown": {
        "clause_1": "ဘောလုံးသည် မောင်ချစ်ညို၏ရှေ့သို့ ကျလာသည်နှင့်တစ်ပြိုင်နက်",
        "clause_2": "သူသည် ဘောလုံးကို ဂိုးပေါက်ဆီသို့ တစ်ရှိန်ထိုး သယ်သွားကာ",
        "clause_3": "ဂိုးဧရိယာအတွင်းသို့ရောက်လျှင်",
        "clause_4": "ဂိုးပေါက်ထဲသို့ တအားကုန် ကန်သွင်းလိုက်ရာ",
        "clause_5": "တည့်တည့်မတ်မတ် ဝင်သွားသည်။"
      },
      "reference": "§193(င)"
    }
  ],
  "analysis_procedure": [
    {
      "id": "AP_01",
      "step": 1,
      "title": "အနက်အဓိပ္ပာယ်အရ ဝါကျအမျိုးအစား သတ်မှတ်ခြင်း",
      "description": "ဝါကျကို ထုတ်ဖော်ဝါကျ၊ မေးခွန်းဝါကျ၊ ငြင်းပယ်ဝါကျ၊ တိုက်တွန်းဝါကျ၊ ဆန္ဒဝါကျတို့မှ ခွဲခြားသတ်မှတ်ရသည်။",
      "checks": [
        "ပြုခြင်း/ဖြစ်ခြင်း/ရှိခြင်းကို ပြသလား (ထုတ်ဖော်ဝါကျ)",
        "မေးမြန်းသောဝါကျလား (မေးခွန်းဝါကျ)",
        "မပြု/မဖြစ်မရှိကို ပြသလား (ငြင်းပယ်ဝါကျ)",
        "အမိန့်/စေခိုင်း/တိုက်တွန်းလား (တိုက်တွန်းဝါကျ)",
        "ဆုတောင်း/ဆုပေး/ကျိန်ဆဲလား (ဆန္ဒဝါကျ)"
      ],
      "reference": "§204(က), §196"
    },
    {
      "id": "AP_02",
      "step": 2,
      "title": "ဖွဲ့စည်းတည်ဆောက်ပုံအရ ဝါကျအမျိုးအစား သတ်မှတ်ခြင်း",
      "description": "ဝါကျကို ဝါကျရိုး (simple) သို့မဟုတ် ဝါကျရော (compound/complex) ဟူ၍ ခွဲခြားရသည်။",
      "checks": [
        "ကတ္တားတစ်ခု + ကြိယာတစ်ခု ပါဝင်လား (ဝါကျရိုး)",
        "ဝါကျရိုးနှစ်ခုထက်ပို၍ ဆက်စပ်ထားလား (ဝါကျရော)"
      ],
      "reference": "§204(ခ), §197"
    },
    {
      "id": "AP_03",
      "step": 3,
      "title": "ဝါကျရိုးဖြစ်ပါက ပုဒ်အမျိုးအစား နှင့် ပုဒ်စုအမျိုးအစား ခွဲခြမ်းစိတ်ဖြာခြင်း",
      "description": "ဝါကျရိုးတွင် ပါဝင်သော ပုဒ်ရိုး၊ ပေါင်းစပ်ပုဒ်၊ ပစ္စည်းရောပုဒ်၊ ဝိဘတ်သွယ်ပုဒ်တို့ကို ခွဲခြားရသည်။",
      "checks": [
        "ကတ္တားပုဒ်၊ ကံပုဒ်၊ ထွက်ခွာရာပြပုဒ်၊ ရှေးရှုရာပြပုဒ်၊ အသုံးခံပြပုဒ်၊ အကြောင်းပြပုဒ်၊ လက်ခံပြပုဒ်၊ နေရာပြပုဒ်၊ အချိန်ပြပုဒ် စသည်တို့ကို ရှာဖွေရန်",
        "ပုဒ်စုအမျိုးအစား (ဝိဘတ်ဆက်/ပစ္စည်းဆက်/သမ္ဗန္ဓဆက်) ကိုခွဲခြားရန်"
      ],
      "reference": "§204(ဂ), §199-203"
    },
    {
      "id": "AP_04",
      "step": 4,
      "title": "ဝါကျရောဖြစ်ပါက ဝါကျကဏ္ဍအမျိုးအစား ခွဲခြမ်းစိတ်ဖြာခြင်း",
      "description": "ဝါကျရောတွင် အမှီခံဝါကျကဏ္ဍနှင့် အမှီဝါကျကဏ္ဍတို့ကို ခွဲခြားရသည်။",
      "checks": [
        "အမှီခံဝါကျကဏ္ဍ (main clause) ကို သတ်မှတ်ရန်",
        "အမှီဝါကျကဏ္ဍ (subordinate clause) ကို သတ်မှတ်ရန်",
        "ဆက်စပ်သည့် ဝိဘတ်/ပစ္စည်း/သမ္ဗန္ဓကို ရှာဖွေရန်"
      ],
      "reference": "§204(ဃ), §198, §139-148"
    },
    {
      "id": "AP_05",
      "step": 5,
      "title": "အမှီခံဝါကျကဏ္ဍ၌ ပုဒ်အမျိုးအစား နှင့် ပုဒ်စုအမျိုးအစား ခွဲခြမ်းစိတ်ဖြာခြင်း",
      "description": "အမှီခံဝါကျကဏ္ဍ (main clause) အတွင်းရှိ ပုဒ်များကို အမျိုးအစားခွဲ၍ ခွဲခြားရသည်။",
      "checks": [
        "အမှီခံဝါကျကဏ္ဍ၏ ကတ္တားပုဒ်ကို သတ်မှတ်ရန်",
        "အမှီခံဝါကျကဏ္ဍ၏ ကြိယာပုဒ်ကို သတ်မှတ်ရန်",
        "ကံ၊ နေရာ၊ အချိန်၊ အကြောင်း စသည့်ပုဒ်များကို ခွဲခြားရန်"
      ],
      "reference": "§204(င)"
    },
    {
      "id": "AP_06",
      "step": 6,
      "title": "အမှီဝါကျကဏ္ဍ၌ ပုဒ်အမျိုးအစား နှင့် ပုဒ်စုအမျိုးအစား ခွဲခြမ်းစိတ်ဖြာခြင်း",
      "description": "အမှီဝါကျကဏ္ဍ (subordinate clause) အတွင်းရှိ ပုဒ်များကို အမျိုးအစားခွဲ၍ ခွဲခြားရသည်။",
      "checks": [
        "အမှီဝါကျကဏ္ဍ၏ ကတ္တားပုဒ်ကို သတ်မှတ်ရန် (မြှုပ်ထားလျှင် ပြန်ထုတ်ရန်)",
        "အမှီဝါကျကဏ္ဍ၏ ကြိယာပုဒ်ကို သတ်မှတ်ရန်",
        "အမှီဝါကျကဏ္ဍ၏ အဆုံးသမ်ဗန္ဓ/ပစ္စည်း/ဝိဘတ်ကို ခွဲခြားရန်",
        "နာမ်ဝါကျကဏ္ဍ/နာမဝိသေသနဝါကျကဏ္ဍ/ကြိယာဝိသေသနဝါကျကဏ္ဍ အမျိုးအစားသတ်မှတ်ရန်"
      ],
      "reference": "§204(စ)"
    }
  ],
    } 
const MYANMAR_GRAMMAR_SEQUENCES = [
  // ==================== A. MINIMAL SENTENCE PATTERNS ====================
  { id: 'msp-01',  seq: ['v'],                       result: 'sentence_minimal_verb_only' },
  { id: 'msp-02',  seq: ['n'],                       result: 'sentence_minimal_noun_only' },
  { id: 'msp-03',  seq: ['n','v'],                   result: 'sentence_minimal_obj_verb' },
  { id: 'msp-04',  seq: ['n','v'],                   result: 'sentence_minimal_loc_verb' },
  { id: 'msp-05',  seq: ['n','v','pt'],              result: 'sentence_minimal_elliptical_verb' },
  { id: 'msp-06a', seq: ['n','v'],                   result: 'sentence_minimal_incremental_2' },
  { id: 'msp-06b', seq: ['n','n','v'],               result: 'sentence_minimal_incremental_3' },
  { id: 'msp-06c', seq: ['n','n','n','v'],           result: 'sentence_minimal_incremental_4' },
  { id: 'msp-06d', seq: ['n','n','n','n','v'],       result: 'sentence_minimal_incremental_5' },
  { id: 'msp-06e', seq: ['n','n','n','n','n','v'],   result: 'sentence_minimal_incremental_6' },
  { id: 'msp-07a', seq: ['n','n','v'],               result: 'sentence_minimal_fronted_3' },
  { id: 'msp-07b', seq: ['n','n','n','v'],           result: 'sentence_minimal_fronted_4' },
  { id: 'msp-07c', seq: ['n','n','n','n','v'],       result: 'sentence_minimal_fronted_5' },

  // ==================== B. SIMPLE SENTENCE PATTERNS ====================
  { id: 'sp-01',  seq: ['n','v'],                       result: 'sentence_simple_subj_verb' },
  { id: 'sp-02',  seq: ['n','n','v'],                   result: 'sentence_simple_subj_comp_verb' },
  { id: 'sp-03',  seq: ['n','n','v'],                   result: 'sentence_simple_subj_obj_verb' },
  { id: 'sp-04',  seq: ['n','n','n','v'],               result: 'sentence_simple_subj_obj_objcomp_verb' },
  { id: 'sp-05',  seq: ['n','n','v'],                   result: 'sentence_simple_subj_source_verb' },
  { id: 'sp-06',  seq: ['n','n','v'],                   result: 'sentence_simple_subj_goal_verb' },
  { id: 'sp-07',  seq: ['n','n','v'],                   result: 'sentence_simple_subj_dest_verb' },
  { id: 'sp-08',  seq: ['n','n','n','v'],               result: 'sentence_simple_subj_obj_instr_verb' },
  { id: 'sp-09',  seq: ['n','n','v'],                   result: 'sentence_simple_subj_cause_verb' },
  { id: 'sp-10',  seq: ['n','n','n','v'],               result: 'sentence_simple_subj_obj_recip_verb' },
  { id: 'sp-11',  seq: ['n','n','v'],                   result: 'sentence_simple_subj_loc_verb' },
  { id: 'sp-12',  seq: ['n','n','v'],                   result: 'sentence_simple_subj_time_verb' },
  { id: 'sp-13',  seq: ['n','n','n','v'],               result: 'sentence_simple_subj_poss_comp_verb' },
  { id: 'sp-14',  seq: ['n','n','n','v'],               result: 'sentence_simple_subj_obj_source_verb' },
  { id: 'sp-15',  seq: ['n','n','n','v'],               result: 'sentence_simple_subj_obj_goal_verb' },
  { id: 'sp-16',  seq: ['n','n','n','v'],               result: 'sentence_simple_subj_source_goal_verb' },
  { id: 'sp-17',  seq: ['n','n','n','v'],               result: 'sentence_simple_subj_obj_loc_verb' },
  { id: 'sp-18',  seq: ['n','n','n','v'],               result: 'sentence_simple_subj_obj_time_verb' },
  { id: 'sp-19',  seq: ['n','n','n','n','v'],          result: 'sentence_simple_subj_src_goal_time_verb' },
  { id: 'sp-20',  seq: ['n','n','n','n','v'],          result: 'sentence_simple_subj_obj_loc_time_verb' },
  { id: 'sp-21',  seq: ['n','dj','n','dv','v'],       result: 'sentence_simple_subj_adj_loc_adv_verb' },
  { id: 'sp-22',  seq: ['dj','n','dj','n','dv','v'],  result: 'sentence_simple_adj_subj_adj_obj_adv_verb' },
  { id: 'sp-23',  seq: ['n','n','v'],                   result: 'sentence_simple_np_loc_verb' },
  { id: 'sp-24',  seq: ['n','n','n','v'],               result: 'sentence_simple_subj_obj_locphrase_verb' },
  { id: 'sp-25',  seq: ['n','n','v'],                   result: 'sentence_simple_subj_timephrase_verb' },
  { id: 'sp-26',  seq: ['n','n','n','v'],               result: 'sentence_simple_subj_obj_instrphrase_verb' },
  { id: 'sp-27',  seq: ['n','n','n','v'],               result: 'sentence_simple_fronted_cause_subj_obj_verb' },
  { id: 'sp-28',  seq: ['n','n','n','v'],               result: 'sentence_simple_fronted_obj_subj_recip_verb' },
  { id: 'sp-29',  seq: ['n','n','v'],                   result: 'sentence_simple_fronted_loc_subj_verb' },
  { id: 'sp-30',  seq: ['n','n','n','v'],               result: 'sentence_simple_ellip_subj_obj_loc_verb' },
  { id: 'sp-31',  seq: ['n','v'],                       result: 'sentence_simple_ellip_subj_verb' },
  { id: 'sp-32',  seq: ['n','n','v'],                   result: 'sentence_simple_ellip_subj_loc_verb' },
  { id: 'sp-33',  seq: ['n','n','v','pt'],              result: 'sentence_simple_subj_comp_ellip_verb_pt' },
  { id: 'sp-34',  seq: ['n','n','v','pt'],              result: 'sentence_simple_subj_loc_ellip_verb_pt' },
  { id: 'sp-35',  seq: ['n','wh','v','pt'],            result: 'sentence_simple_subj_wh_ellip_verb_pt' },
  { id: 'sp-36',  seq: ['n','v','pt'],                  result: 'sentence_simple_subj_ellip_verb_interrog' },
  { id: 'sp-37',  seq: ['n','v','pt'],                  result: 'sentence_simple_obj_ellip_verb_pt' },
  { id: 'sp-38',  seq: ['n','v','pt'],                  result: 'sentence_simple_cause_ellip_verb_pt' },
  { id: 'sp-39',  seq: ['n','v'],                       result: 'sentence_simple_subj_optpt_verb' },
  { id: 'sp-40',  seq: ['n','n','v'],                   result: 'sentence_simple_time_subj_optpt_verb' },
  { id: 'sp-41',  seq: ['n','n','v'],                   result: 'sentence_simple_subj_obj_optpt_verb' },
  { id: 'sp-42',  seq: ['n','n','v'],                   result: 'sentence_simple_subj_obj_verb_plural' },

  // ==================== C. CLAUSE TAXONOMY ====================
  { id: 'ct-nc-01',  seq: ['n','v','pt'], result: 'clause_noun' },
  { id: 'ct-ac-01',  seq: ['n','v','pt'], result: 'clause_adjective' },
  { id: 'ct-avc-01', seq: ['n','v','pt'], result: 'clause_adverbial_concessive' },
  { id: 'ct-avc-02', seq: ['n','v','pt'], result: 'clause_adverbial_temporal' },
  { id: 'ct-avc-03', seq: ['n','v','pt'], result: 'clause_adverbial_purposive' },
  { id: 'ct-avc-04', seq: ['n','v','pt'], result: 'clause_adverbial_causal' },
  { id: 'ct-avc-05', seq: ['n','v','pt'], result: 'clause_adverbial_comparative' },
  { id: 'ct-avc-06', seq: ['n','v','pt'], result: 'clause_adverbial_conditional_restrictive' },
  { id: 'ct-avc-07', seq: ['n','v','pt'], result: 'clause_adverbial_conditional_unrestricted' },
  { id: 'ct-avc-08', seq: ['n','v','pt'], result: 'clause_adverbial_quantitative' },
  { id: 'ct-avc-09', seq: ['n','v','pt'], result: 'clause_adverbial_modal' },

  // ==================== D. SENTENCE CLASSIFICATION (MEANING) ====================
  // Declarative
  { id: 'sc-d-01',   seq: ['n','v','pt'],    result: 'sentence_meaning_declarative' },
  // Interrogative
  { id: 'sc-i-01',   seq: ['n','wh','v','pt'], result: 'sentence_meaning_interrogative_wh' },
  { id: 'sc-i-02',   seq: ['n','v','pt'],    result: 'sentence_meaning_interrogative_yn' },
  { id: 'sc-i-03',   seq: ['n','wh','v','pt'], result: 'sentence_meaning_interrogative_ellip' },
  // Negative
  { id: 'sc-n-01',   seq: ['n','v','pt'],    result: 'sentence_meaning_negative' },
  { id: 'sc-n-02',   seq: ['n','v','pt'],    result: 'sentence_meaning_negative_aux' },
  { id: 'sc-n-03',   seq: ['pt','v','pt'],   result: 'sentence_meaning_negative_structure' },
  // Imperative
  { id: 'sc-imp-04', seq: ['v','pt'],        result: 'sentence_meaning_imperative' },
  { id: 'sc-imp-05', seq: ['n','v','pt'],    result: 'sentence_meaning_imperative_subj' },
  { id: 'sc-imp-06', seq: ['v'],             result: 'sentence_meaning_imperative_zero' },
  // Optative
  { id: 'sc-opt-01', seq: ['n','v','pt'],    result: 'sentence_meaning_optative' },
  { id: 'sc-opt-02', seq: ['v','pt'],        result: 'sentence_meaning_optative_bare' },
  { id: 'sc-opt-03', seq: ['v','pt'],        result: 'sentence_meaning_optative_request' },
  { id: 'sc-opt-04', seq: ['v','pt'],        result: 'sentence_meaning_optative_command' },

  // ==================== E. STRUCTURAL TYPES ====================
  { id: 'str-simp', seq: ['n','v'],         result: 'structure_simple' },
  { id: 'str-cmpl', seq: ['cl','pt','cl'],  result: 'structure_complex' },

  // ==================== F. COMPOUND SENTENCE PATTERNS ====================
  { id: 'csp-01', seq: ['cl','pt'], result: 'compound_clause_obj' },
  { id: 'csp-02', seq: ['cl','pt'], result: 'compound_clause_subj' },
  { id: 'csp-03', seq: ['cl','pt'], result: 'compound_clause_subj_alt' },
  { id: 'csp-04', seq: ['cl','pt'], result: 'compound_clause_quotative' },
  { id: 'csp-05', seq: ['cl','pt'], result: 'compound_clause_adjectival' },
  { id: 'csp-06', seq: ['cl','pt'], result: 'compound_clause_temporal' },
  { id: 'csp-07', seq: ['cl','pt'], result: 'compound_clause_causal' },
  { id: 'csp-08', seq: ['cl','pt','cl','pt','cl'], result: 'compound_multi_clause' },
  { id: 'csp-09', seq: ['cl','pt','cl','pt','cl','pt','cl','pt','cl'], result: 'compound_deep_nest' },

  // ==================== G. WIBAT (PARTICLES ON NOUNS) ====================
  { id: 'wb-n-01',  seq: ['n','pt'], result: 'wibat_noun_obj',          particle: 'ကို' },
  { id: 'wb-n-02',  seq: ['n','pt'], result: 'wibat_noun_source',       particle: 'မှ' },
  { id: 'wb-n-03',  seq: ['n','pt'], result: 'wibat_noun_dest',         particle: 'ထိ' },
  { id: 'wb-n-04',  seq: ['n','pt'], result: 'wibat_noun_dest',         particle: 'အထိ' },
  { id: 'wb-n-05',  seq: ['n','pt'], result: 'wibat_noun_dest',         particle: 'ထိအောင်' },
  { id: 'wb-n-06',  seq: ['n','pt'], result: 'wibat_noun_cause',        particle: 'ကြောင့်' },
  { id: 'wb-n-07',  seq: ['n','pt'], result: 'wibat_noun_recipient',    particle: 'အား' },
  { id: 'wb-n-08',  seq: ['n','pt'], result: 'wibat_noun_accord',       particle: 'အရ' },
  { id: 'wb-n-09',  seq: ['n','pt'], result: 'wibat_noun_accord',       particle: 'အတိုင်း' },
  { id: 'wb-n-10',  seq: ['n','pt'], result: 'wibat_noun_accord',       particle: 'အလိုက်' },
  { id: 'wb-n-11',  seq: ['n','pt'], result: 'wibat_noun_accord',       particle: 'အလျောက်' },
  { id: 'wb-n-12',  seq: ['n','pt'], result: 'wibat_noun_accord',       particle: 'အားလျော်စွာ' },
  { id: 'wb-n-13',  seq: ['n','pt'], result: 'wibat_noun_accord',       particle: 'နှင့်အညီ' },
  { id: 'wb-n-14',  seq: ['n','pt'], result: 'wibat_noun_accord',       particle: 'နှင့်အမျှ' },
  { id: 'wb-n-15',  seq: ['n','pt'], result: 'wibat_noun_together',     particle: 'နှင့်အတူ' },
  { id: 'wb-n-16',  seq: ['n','pt'], result: 'wibat_noun_together',     particle: 'နှင့်တကွ' },
  { id: 'wb-n-17',  seq: ['n','pt'], result: 'wibat_noun_extract',      particle: 'အနက်' },
  { id: 'wb-n-18',  seq: ['n','pt'], result: 'wibat_noun_extract',      particle: 'အထဲမှာ' },
  { id: 'wb-n-19',  seq: ['n','pt'], result: 'wibat_noun_extract',      particle: 'အထဲမှ' },
  { id: 'wb-n-20',  seq: ['n','pt'], result: 'wibat_noun_purpose',      particle: 'ငှာ' },
  { id: 'wb-n-21',  seq: ['n','pt'], result: 'wibat_noun_purpose',      particle: 'အလို့ငှာ' },
  { id: 'wb-n-22',  seq: ['n','pt'], result: 'wibat_noun_purpose',      particle: 'ဖို့' },
  { id: 'wb-n-23',  seq: ['n','pt'], result: 'wibat_noun_purpose',      particle: 'အဖို့' },
  { id: 'wb-n-24',  seq: ['n','pt'], result: 'wibat_noun_purpose',      particle: 'အတွက်' },
  { id: 'wb-n-25',  seq: ['n','pt'], result: 'wibat_noun_duration',     particle: 'ပတ်လုံး' },
  { id: 'wb-n-26',  seq: ['n','pt'], result: 'wibat_noun_duration',     particle: 'လုံးလုံး' },
  // Disambiguating noun particles
  { id: 'wb-n-d1', seq: ['n','pt'], result: 'wibat_noun_disambig_subj', particle: 'သည်' },
  { id: 'wb-n-d2', seq: ['n','pt'], result: 'wibat_noun_disambig_poss', particle: '၏' },
  { id: 'wb-n-d3', seq: ['n','pt'], result: 'wibat_noun_disambig_subj', particle: 'က' },
  { id: 'wb-n-d4', seq: ['n','pt'], result: 'wibat_noun_disambig_subj', particle: 'မှာ' },
  { id: 'wb-n-d5', seq: ['n','pt'], result: 'wibat_noun_disambig_goal', particle: 'သို့' },
  { id: 'wb-n-d6', seq: ['n','pt'], result: 'wibat_noun_disambig_instr',particle: 'ဖြင့်' },
  { id: 'wb-n-d7', seq: ['n','pt'], result: 'wibat_noun_disambig_and',  particle: 'နှင့်' },
  { id: 'wb-n-d8', seq: ['n','pt'], result: 'wibat_noun_disambig_loc',  particle: '၌' },
  { id: 'wb-n-d9', seq: ['n','pt'], result: 'wibat_noun_disambig_loc',  particle: 'တွင်' },
  { id: 'wb-n-d10',seq: ['n','pt'], result: 'wibat_noun_disambig_loc',  particle: 'ဝယ်' },
  { id: 'wb-n-d11',seq: ['n','pt'], result: 'wibat_noun_disambig_until',particle: 'တိုင်တိုင်' },
  { id: 'wb-n-d12',seq: ['n','pt'], result: 'wibat_noun_disambig_until',particle: 'တိုင်အောင်' },

  // ==================== H. WIBAT (PARTICLES ON VERBS) ====================
  { id: 'wb-v-01', seq: ['v','pt'], result: 'wibat_verb_past',        particle: 'ပြီ' },
  { id: 'wb-v-02', seq: ['v','pt'], result: 'wibat_verb_future',      particle: 'မည်' },
  { id: 'wb-v-03', seq: ['v','pt'], result: 'wibat_verb_future',      particle: 'လိမ့်မည်' },
  { id: 'wb-v-04', seq: ['v','pt'], result: 'wibat_verb_future',      particle: 'အံ့' },
  { id: 'wb-v-05', seq: ['v','pt'], result: 'wibat_verb_future',      particle: 'လတ္တံ့' },
  { id: 'wb-v-06', seq: ['v','pt'], result: 'wibat_verb_imperative',  particle: 'လော့' },
  { id: 'wb-v-07', seq: ['v','pt'], result: 'wibat_verb_hortative',   particle: 'စို့' },
  { id: 'wb-v-08', seq: ['v','pt'], result: 'wibat_verb_hortative',   particle: 'ရအောင်' },
  { id: 'wb-v-09', seq: ['v','pt'], result: 'wibat_verb_optative',    particle: 'ပါရစေ' },
  { id: 'wb-v-10', seq: ['v','pt'], result: 'wibat_verb_optative',    particle: 'ပါစေ' },
  { id: 'wb-v-11', seq: ['v','pt'], result: 'wibat_verb_command',     particle: 'စေ' },
  // Disambiguating verb particles
  { id: 'wb-v-d1', seq: ['v','pt'], result: 'wibat_verb_disambig_declarative', particle: 'သည်' },
  { id: 'wb-v-d2', seq: ['v','pt'], result: 'wibat_verb_disambig_declarative', particle: '၏' },

  // ==================== I. THANBANDA (CLAUSE CONNECTORS) ====================
  { id: 'tb-cl-01', seq: ['cl','pt'], result: 'thanbanda_clause_also',     particle: 'လည်းကောင်း' },
  { id: 'tb-cl-02', seq: ['cl','pt'], result: 'thanbanda_clause_also',     particle: 'ရော' },
  { id: 'tb-cl-03', seq: ['cl','pt'], result: 'thanbanda_clause_also',     particle: 'ပါ' },
  { id: 'tb-cl-04', seq: ['cl','pt'], result: 'thanbanda_clause_also',     particle: 'ရောရော' },
  { id: 'tb-cl-05', seq: ['cl','pt'], result: 'thanbanda_clause_also',     particle: 'ဖြစ်ဖြစ်' },
  { id: 'tb-cl-06', seq: ['cl','pt'], result: 'thanbanda_clause_except',   particle: 'မှတစ်ပါး' },
  { id: 'tb-cl-07', seq: ['cl','pt'], result: 'thanbanda_clause_compare',  particle: 'သလို' },
  { id: 'tb-cl-08', seq: ['cl','pt'], result: 'thanbanda_clause_compare',  particle: 'ထက်' },
  { id: 'tb-cl-09', seq: ['cl','pt'], result: 'thanbanda_clause_together', particle: 'လည်း' },
  { id: 'tb-cl-10', seq: ['cl','pt'], result: 'thanbanda_clause_restrict', particle: 'က' },
  { id: 'tb-cl-11', seq: ['cl','pt'], result: 'thanbanda_clause_unrestrict',particle: 'ဖြစ်စေ…ဖြစ်စေ' },
  // Disambiguating
  { id: 'tb-cl-d1', seq: ['cl','pt'], result: 'thanbanda_clause_disambig_and', particle: 'နှင့်' },
  { id: 'tb-cl-d2', seq: ['cl','pt'], result: 'thanbanda_clause_disambig_or',  particle: 'သို့မဟုတ်' },
  { id: 'tb-cl-d3', seq: ['cl','pt'], result: 'thanbanda_clause_disambig_but', particle: 'သော်လည်းကောင်း' },

  // ==================== J. THANBANDA (SENTENCE CONNECTORS) ====================
  { id: 'tb-sn-01', seq: ['pt','cl'], result: 'thanbanda_sentence_cause',     particle: 'အကြောင်းမူကား' },
  { id: 'tb-sn-02', seq: ['pt','cl'], result: 'thanbanda_sentence_further',   particle: 'ထို့ပြင်' },
  { id: 'tb-sn-03', seq: ['pt','cl'], result: 'thanbanda_sentence_then',      particle: 'ထို့နောက်' },
  { id: 'tb-sn-04', seq: ['pt','cl'], result: 'thanbanda_sentence_then',      particle: 'ထိုအခါ' },
  { id: 'tb-sn-05', seq: ['pt','cl'], result: 'thanbanda_sentence_concessive',particle: 'လင့်ကစား' },
  { id: 'tb-sn-06', seq: ['pt','cl'], result: 'thanbanda_sentence_concessive',particle: 'စေကာမူ' },
  { id: 'tb-sn-07', seq: ['pt','cl'], result: 'thanbanda_sentence_concessive',particle: 'လျက်နှင့်' },
  { id: 'tb-sn-08', seq: ['pt','cl'], result: 'thanbanda_sentence_temporal',  particle: 'မှစ၍' },
  { id: 'tb-sn-09', seq: ['pt','cl'], result: 'thanbanda_sentence_temporal',  particle: 'တိုင်' },
  { id: 'tb-sn-10', seq: ['pt','cl'], result: 'thanbanda_sentence_temporal',  particle: 'တိုင်အောင်' },
  { id: 'tb-sn-11', seq: ['pt','cl'], result: 'thanbanda_sentence_temporal',  particle: 'အခါတိုင်း' },
  { id: 'tb-sn-12', seq: ['pt','cl'], result: 'thanbanda_sentence_temporal',  particle: 'စဉ်' },
  { id: 'tb-sn-13', seq: ['pt','cl'], result: 'thanbanda_sentence_temporal',  particle: 'တုန်း' },
  { id: 'tb-sn-14', seq: ['pt','cl'], result: 'thanbanda_sentence_temporal',  particle: 'သမျှ' },
  { id: 'tb-sn-15', seq: ['pt','cl'], result: 'thanbanda_sentence_purpose',   particle: 'အောင်' },
  { id: 'tb-sn-16', seq: ['pt','cl'], result: 'thanbanda_sentence_purpose',   particle: 'ရန်' },
  { id: 'tb-sn-17', seq: ['pt','cl'], result: 'thanbanda_sentence_purpose',   particle: 'ဖို့' },
  { id: 'tb-sn-18', seq: ['pt','cl'], result: 'thanbanda_sentence_purpose',   particle: 'ရန်အလို့ငှာ' },
  { id: 'tb-sn-19', seq: ['pt','cl'], result: 'thanbanda_sentence_purpose',   particle: 'ရန်အတွက်' },
  { id: 'tb-sn-20', seq: ['pt','cl'], result: 'thanbanda_sentence_causal',    particle: 'သောကြောင့်' },
  { id: 'tb-sn-21', seq: ['pt','cl'], result: 'thanbanda_sentence_causal',    particle: 'သဖြင့်' },
  { id: 'tb-sn-22', seq: ['pt','cl'], result: 'thanbanda_sentence_causal',    particle: 'လို့' },
  { id: 'tb-sn-23', seq: ['pt','cl'], result: 'thanbanda_sentence_causal',    particle: 'သို့ဖြစ်၍' },
  // Disambiguating
  { id: 'tb-sn-d1', seq: ['pt','cl'], result: 'thanbanda_sentence_disambig_simul', particle: 'နှင့်တစ်ပြိုင်နက်' },
  { id: 'tb-sn-d2', seq: ['pt','cl'], result: 'thanbanda_sentence_disambig_but',   particle: 'သော်လည်း' },
  { id: 'tb-sn-d3', seq: ['pt','cl'], result: 'thanbanda_sentence_disambig_but',   particle: 'သို့ရာတွင်' },
  { id: 'tb-sn-d4', seq: ['pt','cl'], result: 'thanbanda_sentence_disambig_and',   particle: '၍' },
  { id: 'tb-sn-d5', seq: ['pt','cl'], result: 'thanbanda_sentence_disambig_cause', particle: 'ထို့ကြောင့်' },
  { id: 'tb-sn-d6', seq: ['pt','cl'], result: 'thanbanda_sentence_disambig_why',   particle: 'အဘယ်ကြောင့်ဆိုသော်' },

  // ==================== K. PACcAYA (NOUN SUFFIXES) ====================
  { id: 'pc-n-01', seq: ['n','pt'], result: 'paccaya_noun_classifier',  particle: 'ကောင်' },
  { id: 'pc-n-02', seq: ['n','pt'], result: 'paccaya_noun_classifier',  particle: 'ခု' },
  { id: 'pc-n-03', seq: ['n','pt'], result: 'paccaya_noun_classifier',  particle: 'ခွန်း' },
  { id: 'pc-n-04', seq: ['n','pt'], result: 'paccaya_noun_classifier',  particle: 'စောင်' },
  { id: 'pc-n-05', seq: ['n','pt'], result: 'paccaya_noun_classifier',  particle: 'ဆူ' },
  { id: 'pc-n-06', seq: ['n','pt'], result: 'paccaya_noun_classifier',  particle: 'ထည်' },
  { id: 'pc-n-07', seq: ['n','pt'], result: 'paccaya_noun_classifier',  particle: 'ပါး' },
  { id: 'pc-n-08', seq: ['n','pt'], result: 'paccaya_noun_classifier',  particle: 'ယောက်' },
  { id: 'pc-n-09', seq: ['n','pt'], result: 'paccaya_noun_classifier',  particle: 'လက်' },
  { id: 'pc-n-10', seq: ['n','pt'], result: 'paccaya_noun_classifier',  particle: 'ဖုံ' },
  { id: 'pc-n-11', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'သား' },
  { id: 'pc-n-12', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'ထီး' },
  { id: 'pc-n-13', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'ဖ' },
  { id: 'pc-n-14', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'ဖို' },
  { id: 'pc-n-15', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'မောင်' },
  { id: 'pc-n-16', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'ကို' },
  { id: 'pc-n-17', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'ဖိုး' },
  { id: 'pc-n-18', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'ဦး' },
  { id: 'pc-n-19', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'သူ' },
  { id: 'pc-n-20', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'မ' },
  { id: 'pc-n-21', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'မိ' },
  { id: 'pc-n-22', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'မယ်' },
  { id: 'pc-n-23', seq: ['n','pt'], result: 'paccaya_noun_gender',      particle: 'ဒေါ်' },
  { id: 'pc-n-24', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'တို့' },
  { id: 'pc-n-25', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'တိတိ' },
  { id: 'pc-n-26', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'ကျ' },
  { id: 'pc-n-27', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'စီ' },
  { id: 'pc-n-28', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'ကျစီ' },
  { id: 'pc-n-29', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'လုံး' },
  { id: 'pc-n-30', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'စလုံး' },
  { id: 'pc-n-31', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'တည်း' },
  { id: 'pc-n-32', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'လျှင်' },
  { id: 'pc-n-33', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'ကျော်' },
  { id: 'pc-n-34', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'ခန့်' },
  { id: 'pc-n-35', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'လောက်' },
  { id: 'pc-n-36', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'ကြိမ်' },
  { id: 'pc-n-37', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'ခါ' },
  { id: 'pc-n-38', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'ခေါက်' },
  { id: 'pc-n-39', seq: ['n','pt'], result: 'paccaya_noun_number',      particle: 'မြောက်' },
  { id: 'pc-n-40', seq: ['n','pt'], result: 'paccaya_noun_emphasis',    particle: 'သာ' },
  { id: 'pc-n-41', seq: ['n','pt'], result: 'paccaya_noun_emphasis',    particle: 'သာလျှင်' },
  { id: 'pc-n-42', seq: ['n','pt'], result: 'paccaya_noun_emphasis',    particle: 'ချည်း' },
  { id: 'pc-n-43', seq: ['n','pt'], result: 'paccaya_noun_emphasis',    particle: 'ရော' },
  { id: 'pc-n-44', seq: ['n','pt'], result: 'paccaya_noun_emphasis',    particle: 'လည်း' },
  { id: 'pc-n-45', seq: ['n','pt'], result: 'paccaya_noun_emphasis',    particle: 'တောင်' },
  { id: 'pc-n-46', seq: ['n','pt'], result: 'paccaya_noun_simile',      particle: 'ကဲ့သို့' },
  { id: 'pc-n-47', seq: ['n','pt'], result: 'paccaya_noun_simile',      particle: 'လို' },
  { id: 'pc-n-48', seq: ['n','pt'], result: 'paccaya_noun_simile',      particle: 'နှယ်' },
  { id: 'pc-n-49', seq: ['n','pt'], result: 'paccaya_noun_simile',      particle: 'အတိုင်း' },
  { id: 'pc-n-50', seq: ['n','pt'], result: 'paccaya_noun_vocative',    particle: 'အို' },
  { id: 'pc-n-51', seq: ['n','pt'], result: 'paccaya_noun_vocative',    particle: 'ဟယ်' },
  { id: 'pc-n-52', seq: ['n','pt'], result: 'paccaya_noun_vocative',    particle: 'ရေ' },
  { id: 'pc-n-53', seq: ['n','pt'], result: 'paccaya_noun_vocative',    particle: 'ဗျို့' },
  { id: 'pc-n-54', seq: ['n','pt'], result: 'paccaya_noun_vocative',    particle: 'ခင်ဗျာ' },
  { id: 'pc-n-55', seq: ['n','pt'], result: 'paccaya_noun_vocative',    particle: 'ဟေ့' },
  { id: 'pc-n-56', seq: ['n','pt'], result: 'paccaya_noun_universal',   particle: 'တိုင်း' },
  { id: 'pc-n-57', seq: ['n','pt'], result: 'paccaya_noun_universal',   particle: 'တကာ' },
  // Disambiguating noun paccaya
  { id: 'pc-n-d1', seq: ['n','pt'], result: 'paccaya_noun_disambig_even', particle: 'ပင်' },
  { id: 'pc-n-d2', seq: ['n','pt'], result: 'paccaya_noun_disambig_plural',particle: 'များ' },

  // ==================== L. PACcAYA (VERB SUFFIXES) ====================
  { id: 'pc-v-01', seq: ['v','pt'], result: 'paccaya_verb_question',   particle: 'နည်း' },
  { id: 'pc-v-02', seq: ['v','pt'], result: 'paccaya_verb_question',   particle: 'လော' },
  { id: 'pc-v-03', seq: ['v','pt'], result: 'paccaya_verb_question',   particle: 'စ' },
  { id: 'pc-v-04', seq: ['v','pt'], result: 'paccaya_verb_question',   particle: 'လား' },
  { id: 'pc-v-05', seq: ['v','pt'], result: 'paccaya_verb_question',   particle: 'လဲ' },
  { id: 'pc-v-06', seq: ['v','pt'], result: 'paccaya_verb_question',   particle: 'တုံး' },
  { id: 'pc-v-07', seq: ['v','pt'], result: 'paccaya_verb_plural',     particle: 'ကြ' },
  { id: 'pc-v-08', seq: ['v','pt'], result: 'paccaya_verb_plural',     particle: 'ကုန်' },
  { id: 'pc-v-09', seq: ['v','pt'], result: 'paccaya_verb_plural',     particle: 'ကြကုန်' },
  { id: 'pc-v-10', seq: ['v','pt'], result: 'paccaya_verb_aux_desire', particle: 'ချင်' },
  { id: 'pc-v-11', seq: ['v','pt'], result: 'paccaya_verb_aux_know',   particle: 'တတ်' },
  { id: 'pc-v-12', seq: ['v','pt'], result: 'paccaya_verb_aux_able',   particle: 'နိုင်' },
  { id: 'pc-v-13', seq: ['v','pt'], result: 'paccaya_verb_aux_ever',   particle: 'ဖူး' },
  { id: 'pc-v-14', seq: ['v','pt'], result: 'paccaya_verb_aux_dare',   particle: 'ဝံ့' },
  { id: 'pc-v-15', seq: ['v','pt'], result: 'paccaya_verb_aux_difficult',particle: 'ခဲ' },
  { id: 'pc-v-16', seq: ['v','pt'], result: 'paccaya_verb_aux_past',   particle: 'ခဲ့' },
  { id: 'pc-v-17', seq: ['v','pt'], result: 'paccaya_verb_aux_accidental',particle: 'မိ' },
  { id: 'pc-v-18', seq: ['v','pt'], result: 'paccaya_verb_aux_should', particle: 'သင့်' },
  { id: 'pc-v-19', seq: ['v','pt'], result: 'paccaya_verb_aux_search', particle: 'ရှာ' },
  { id: 'pc-v-20', seq: ['v','pt'], result: 'paccaya_verb_aux_excess', particle: 'လွန်း' },
  { id: 'pc-v-21', seq: ['v','pt'], result: 'paccaya_verb_aux_beautiful',particle: 'လှ' },
  { id: 'pc-v-22', seq: ['v','pt'], result: 'paccaya_verb_aux_cruel',  particle: 'ရက်' },
  { id: 'pc-v-23', seq: ['v','pt'], result: 'paccaya_verb_aux_yet',    particle: 'သေး' },
  { id: 'pc-v-24', seq: ['v','pt'], result: 'paccaya_verb_aux_first',  particle: 'ဦး' },
  { id: 'pc-v-25', seq: ['v','pt'], result: 'paccaya_verb_aux_must',   particle: 'အပ်' },
  { id: 'pc-v-26', seq: ['v','pt'], result: 'paccaya_verb_aux_obtain', particle: 'ရ' },
  { id: 'pc-v-27', seq: ['v','pt'], result: 'paccaya_verb_aux_deserve',particle: 'ထိုက်' },
  { id: 'pc-v-28', seq: ['v','pt'], result: 'paccaya_verb_aux_progressive',particle: 'နေ' },
  { id: 'pc-v-29', seq: ['v','pt'], result: 'paccaya_verb_aux_again',  particle: 'ပြန်' },
  { id: 'pc-v-30', seq: ['v','pt'], result: 'paccaya_verb_aux_and',    particle: 'နှင့်' },
  { id: 'pc-v-31', seq: ['v','pt'], result: 'paccaya_verb_aux_go',     particle: 'သွား' },
  { id: 'pc-v-32', seq: ['v','pt'], result: 'paccaya_verb_aux_remain', particle: 'ရစ်' },
  { id: 'pc-v-33', seq: ['v','pt'], result: 'paccaya_verb_aux_keep',   particle: 'ထား' },
  { id: 'pc-v-34', seq: ['v','pt'], result: 'paccaya_verb_aux_enjoy',  particle: 'ပျော်' },
  { id: 'pc-v-35', seq: ['v','pt'], result: 'paccaya_verb_aux_throw',  particle: 'ပစ်' },
  // Negation
  { id: 'pc-v-36', seq: ['pt','v'], result: 'paccaya_verb_neg_pre',    particle: 'မ' },
  { id: 'pc-v-37', seq: ['v','pt'], result: 'paccaya_verb_neg_post_bu',particle: 'ဘူး' },
  { id: 'pc-v-38', seq: ['v','pt'], result: 'paccaya_verb_neg_post_ne',particle: 'နဲ့' },
  { id: 'pc-v-39', seq: ['v','pt'], result: 'paccaya_verb_neg_post_ne',particle: 'နှင့်' },
  { id: 'pc-v-40', seq: ['v','pt'], result: 'paccaya_verb_neg_post_pang',particle: 'ပေါင်' },
  { id: 'pc-v-41', seq: ['v','pt'], result: 'paccaya_verb_neg_post_be',particle: 'ဘဲ' },
  { id: 'pc-v-42', seq: ['v','pt'], result: 'paccaya_verb_neg_post_be',particle: 'ဘဲကို' },
  // Sentence-final
  { id: 'pc-v-43', seq: ['v','pt'], result: 'paccaya_verb_final_kwa',  particle: 'ကွာ' },
  { id: 'pc-v-44', seq: ['v','pt'], result: 'paccaya_verb_final_kwe',  particle: 'ကွယ်' },
  { id: 'pc-v-45', seq: ['v','pt'], result: 'paccaya_verb_final_naw',  particle: 'နော်' },
  { id: 'pc-v-46', seq: ['v','pt'], result: 'paccaya_verb_final_po',   particle: 'ပေါ့' },
  { id: 'pc-v-47', seq: ['v','pt'], result: 'paccaya_verb_final_lay',  particle: 'လေ' },
  { id: 'pc-v-48', seq: ['v','pt'], result: 'paccaya_verb_final_poby', particle: 'ပေါ့ဗျာ' },
  { id: 'pc-v-49', seq: ['v','pt'], result: 'paccaya_verb_final_polay',particle: 'ပေါ့လေ' },
  { id: 'pc-v-50', seq: ['v','pt'], result: 'paccaya_verb_final_laykwe',particle: 'လေကွယ်' },
  // Disambiguating verb paccaya
  { id: 'pc-v-d1', seq: ['v','pt'], result: 'paccaya_verb_disambig_polite', particle: 'ပါ' },
  { id: 'pc-v-d2', seq: ['v','pt'], result: 'paccaya_verb_disambig_quote',  particle: 'လို့' },

  // ==================== M. WORD-CHANGERS (DERIVATIONAL) ====================
  // Noun → Noun/Verbal noun
  { id: 'wc-nn-01', seq: ['v','pt'], result: 'wordchange_verb_to_noun', particle: 'ချက်' },
  { id: 'wc-nn-02', seq: ['v','pt'], result: 'wordchange_verb_to_noun', particle: 'ဖွယ်' },
  { id: 'wc-nn-03', seq: ['v','pt'], result: 'wordchange_verb_to_noun', particle: 'စရာ' },
  { id: 'wc-nn-04', seq: ['v','pt'], result: 'wordchange_verb_to_noun', particle: 'ဖို့' },
  { id: 'wc-nn-05', seq: ['v','pt'], result: 'wordchange_verb_to_noun', particle: 'ရန်' },
  // Noun → Adjective (relative clauses)
  { id: 'wc-na-01', seq: ['n','pt'], result: 'wordchange_noun_to_adj',  particle: 'သော' },
  { id: 'wc-na-02', seq: ['n','pt'], result: 'wordchange_noun_to_adj',  particle: 'သည့်' },
  { id: 'wc-na-03', seq: ['n','pt'], result: 'wordchange_noun_to_adj',  particle: 'မည့်' },
  // Verb → Adverb
  { id: 'wc-va-01', seq: ['v','pt'], result: 'wordchange_verb_to_adv',  particle: 'စွာ' },
  { id: 'wc-va-02', seq: ['v','pt'], result: 'wordchange_verb_to_adv',  particle: 'တ-တ' },
  { id: 'wc-va-03', seq: ['v','pt'], result: 'wordchange_verb_to_adv',  particle: 'အ-တ' },
  { id: 'wc-va-04', seq: ['v','pt'], result: 'wordchange_verb_to_adv',  particle: 'ချည်-ချည်' },
  // Disambiguating
  { id: 'wc-d1',   seq: ['*','pt'], result: 'wordchange_disambig_a',   particle: 'အ' },
  { id: 'wc-d2',   seq: ['v','pt'], result: 'wordchange_disambig_nominalizer', particle: 'ခြင်း' },
  { id: 'wc-d3',   seq: ['v','pt'], result: 'wordchange_disambig_nominalizer', particle: 'မှု' },

  // ==================== N. PARTICLE STACKING (CHAINED) ====================
  { id: 'ps-01', seq: ['v','pt','pt'], result: 'particle_stack_2' },
  { id: 'ps-02', seq: ['v','pt','pt','pt'], result: 'particle_stack_3' },
  { id: 'ps-03', seq: ['v','pt','pt','pt','pt'], result: 'particle_stack_4' },
  { id: 'ps-04', seq: ['v','pt','pt','pt','pt','pt'], result: 'particle_stack_5' },

  // ==================== O. COMPOUND WORDS (from your example) ====================
  // Compound Noun
  { id: '1-a',  seq: ['n','n'],             result: 'compound_noun' },
  { id: '1-b',  seq: ['n','n','n'],         result: 'compound_noun' },
  { id: '1-c',  seq: ['n','v'],             result: 'compound_noun' },
  { id: '1-d',  seq: ['v','v'],             result: 'compound_noun' },
  { id: '1-e',  seq: ['v','v','n'],         result: 'compound_noun' },
  { id: '1-f',  seq: ['v','v','v','v'],     result: 'compound_noun' },
  { id: '1-g',  seq: ['n','v','dj'],        result: 'compound_noun' },
  { id: '1-h',  seq: ['n','dj','v'],        result: 'compound_noun' },
  { id: '1-i',  seq: ['n','n','v'],         result: 'compound_noun' },
  { id: '1-j',  seq: ['n','n','dj'],        result: 'compound_noun' },
  { id: '1-k',  seq: ['n','dj','n'],        result: 'compound_noun' },
  { id: '1-l',  seq: ['n','v','n','v'],     result: 'compound_noun' },
  { id: '1-m',  seq: ['n','dj','v','n'],    result: 'compound_noun' },
  { id: '1-n',  seq: ['n','v','n','n'],     result: 'compound_noun' },
  { id: '1-o',  seq: ['n','v','v','v','n'], result: 'compound_noun' },
  // Compound Verb
  { id: '2-a',  seq: ['v','v'],             result: 'compound_verb' },
  { id: '2-b',  seq: ['v','v','v'],         result: 'compound_verb' },
  { id: '2-c',  seq: ['v','v','v','v'],     result: 'compound_verb' },
  { id: '2-d',  seq: ['n','v'],             result: 'compound_verb' },
  { id: '2-e',  seq: ['n','dj','v'],        result: 'compound_verb' },
  { id: '2-f',  seq: ['dj','n','v'],        result: 'compound_verb' },
  { id: '2-g',  seq: ['n','v','v'],         result: 'compound_verb' },
  { id: '2-h',  seq: ['v','n','v'],         result: 'compound_verb' },
  { id: '2-i',  seq: ['n','n','v','v'],     result: 'compound_verb' },
  { id: '2-j',  seq: ['n','v','n','v'],     result: 'compound_verb' },
  // Compound Adj
  { id: '3-a',  seq: ['dj','dj'],           result: 'compound_adj' },
  { id: '3-b',  seq: ['dj','dj','dj'],      result: 'compound_adj' },
  { id: '3-c',  seq: ['dj','dj','dj','dj'], result: 'compound_adj' },
  { id: '3-d',  seq: ['n','dj'],            result: 'compound_adj' },
  // Compound Adv
  { id: '4-a',  seq: ['v','v'],             result: 'compound_adv' },
  { id: '4-b',  seq: ['v','v','v','v'],     result: 'compound_adv' },
  { id: '4-c',  seq: ['dj','dj'],           result: 'compound_adv' },
  { id: '4-d',  seq: ['dj','dj','dj'],      result: 'compound_adv' },
  { id: '4-e',  seq: ['dj','dj','dj','dj'], result: 'compound_adv' },
  { id: '4-f',  seq: ['n','dj','dv'],       result: 'compound_adv' },
  { id: '4-g',  seq: ['n','n','v'],         result: 'compound_adv' },
  { id: '4-h',  seq: ['n','v','n','v'],     result: 'compound_adv' },
  { id: '4-i',  seq: ['n','n','n','v'],     result: 'compound_adv' },
];
