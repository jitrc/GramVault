// rules.js — Fast rule-based grammar checker (no LLM, runs synchronously)
// Returns errors in the same format as the LLM checker for easy merging.

const GrammarRules = (() => {
  // Common misspellings dictionary
  const MISSPELLINGS = {
    'accomodate': 'accommodate', 'acheive': 'achieve', 'accross': 'across',
    'agressive': 'aggressive', 'apparantly': 'apparently', 'arguement': 'argument',
    'basicly': 'basically', 'beacuse': 'because', 'becuase': 'because',
    'begining': 'beginning', 'beleive': 'believe', 'buisness': 'business',
    'calender': 'calendar', 'catagory': 'category', 'cemetary': 'cemetery',
    'changable': 'changeable', 'collegue': 'colleague', 'comming': 'coming',
    'commited': 'committed', 'comparision': 'comparison', 'competance': 'competence',
    'concious': 'conscious', 'concensus': 'consensus', 'copywrite': 'copyright',
    'curiousity': 'curiosity', 'definately': 'definitely', 'definitly': 'definitely',
    'dependant': 'dependent', 'desparate': 'desperate', 'develope': 'develop',
    'dilema': 'dilemma', 'disapear': 'disappear', 'disapoint': 'disappoint',
    'doesnt': "doesn't", 'embarass': 'embarrass', 'enviroment': 'environment',
    'exagerate': 'exaggerate', 'excercise': 'exercise', 'existance': 'existence',
    'experiance': 'experience', 'facinate': 'fascinate', 'finaly': 'finally',
    'foriegn': 'foreign', 'fourty': 'forty', 'freind': 'friend',
    'goverment': 'government', 'gaurd': 'guard', 'gratefull': 'grateful',
    'garantee': 'guarantee', 'harrass': 'harass', 'heighth': 'height',
    'heros': 'heroes', 'humourous': 'humorous', 'hygeine': 'hygiene',
    'ignorence': 'ignorance', 'immediatly': 'immediately', 'incidently': 'incidentally',
    'independant': 'independent', 'indispensible': 'indispensable', 'innoculate': 'inoculate',
    'intellegent': 'intelligent', 'intresting': 'interesting', 'irresistable': 'irresistible',
    'jewlery': 'jewelry', 'judgement': 'judgment', 'knowlege': 'knowledge',
    'lenght': 'length', 'liason': 'liaison', 'libary': 'library',
    'liscense': 'license', 'maintenence': 'maintenance', 'millenium': 'millennium',
    'miniscule': 'minuscule', 'mischievious': 'mischievous', 'mispell': 'misspell',
    'neccessary': 'necessary', 'necessery': 'necessary', 'negociate': 'negotiate',
    'nieghbor': 'neighbor', 'noticable': 'noticeable', 'occassion': 'occasion',
    'occurence': 'occurrence', 'occured': 'occurred', 'omision': 'omission',
    'oppurtunity': 'opportunity', 'orignal': 'original', 'outragous': 'outrageous',
    'parliment': 'parliament', 'pasttime': 'pastime', 'percieve': 'perceive',
    'perseverence': 'perseverance', 'personel': 'personnel', 'plagerism': 'plagiarism',
    'posession': 'possession', 'potatos': 'potatoes', 'preceed': 'precede',
    'privelege': 'privilege', 'professer': 'professor', 'promiss': 'promise',
    'pronounciation': 'pronunciation', 'publically': 'publicly', 'que': 'queue',
    'realy': 'really', 'recieve': 'receive', 'reccomend': 'recommend',
    'recomend': 'recommend', 'refrence': 'reference', 'referance': 'reference',
    'relevent': 'relevant', 'religous': 'religious', 'remeber': 'remember',
    'repitition': 'repetition', 'resistence': 'resistance', 'restarant': 'restaurant',
    'rythm': 'rhythm', 'sacrilegious': 'sacrilegious', 'seize': 'seize',
    'sentance': 'sentence', 'seperate': 'separate', 'sergent': 'sergeant',
    'shouldnt': "shouldn't", 'similer': 'similar', 'sincerly': 'sincerely',
    'speach': 'speech', 'strenght': 'strength', 'succesful': 'successful',
    'successfull': 'successful', 'supercede': 'supersede', 'surprize': 'surprise',
    'temperture': 'temperature', 'tendancy': 'tendency', 'therefor': 'therefore',
    'threshhold': 'threshold', 'tommorow': 'tomorrow', 'tommorrow': 'tomorrow',
    'tounge': 'tongue', 'truely': 'truly', 'tyrany': 'tyranny',
    'underate': 'underrate', 'unfortunatly': 'unfortunately', 'untill': 'until',
    'unusuall': 'unusual', 'useable': 'usable', 'vaccuum': 'vacuum',
    'vegatable': 'vegetable', 'vehical': 'vehicle', 'vicious': 'vicious',
    'wether': 'whether', 'wierd': 'weird', 'wellfare': 'welfare',
    'whereever': 'wherever', 'whitch': 'which', 'wholely': 'wholly',
    'wouldnt': "wouldn't", 'writting': 'writing', 'youre': "you're",
    'alot': 'a lot', 'cant': "can't", 'didnt': "didn't", 'dont': "don't",
    'hasnt': "hasn't", 'havent': "haven't", 'isnt': "isn't", 'its a': "it's a",
    'thats': "that's", 'theyre': "they're", 'wasnt': "wasn't", 'wont': "won't",
    'teh': 'the', 'adn': 'and', 'hte': 'the', 'taht': 'that', 'waht': 'what',
    'recieved': 'received', 'beileve': 'believe', 'wich': 'which',
    'occuring': 'occurring', 'untill': 'until', 'thier': 'their',
    'beggining': 'beginning', 'belive': 'believe', 'goverment': 'government',
    'happend': 'happened', 'occassionally': 'occasionally', 'tomatos': 'tomatoes',
  };

  // Vowel check for a/an rule
  const VOWEL_SOUNDS = /^[aeiou]/i;
  const VOWEL_EXCEPTIONS = /^(uni|use|usu|eur|one|once)/i; // "a uniform", not "an uniform"
  const CONSONANT_EXCEPTIONS = /^(hour|honest|honor|heir|herb)/i; // "an hour", not "a hour"

  function startsWithVowelSound(word) {
    if (CONSONANT_EXCEPTIONS.test(word)) return true;
    if (VOWEL_EXCEPTIONS.test(word)) return false;
    return VOWEL_SOUNDS.test(word);
  }

  // The rule definitions
  const rules = [
    // --- DOUBLED WORDS ---
    {
      name: 'double-word',
      check(text) {
        const errors = [];
        const re = /\b(\w+)\s+\1\b/gi;
        let m;
        while ((m = re.exec(text)) !== null) {
          errors.push({
            start: m.index,
            end: m.index + m[0].length,
            original: m[0],
            message: `Repeated word: "${m[1]}"`,
            suggestions: [m[1]],
            source: 'rules',
          });
        }
        return errors;
      },
    },

    // --- A/AN MISUSE ---
    {
      name: 'a-an',
      check(text) {
        const errors = [];
        const re = /\b(a|an)\s+(\w+)/gi;
        let m;
        while ((m = re.exec(text)) !== null) {
          const article = m[1].toLowerCase();
          const nextWord = m[2];
          const needsAn = startsWithVowelSound(nextWord);

          if (article === 'a' && needsAn) {
            errors.push({
              start: m.index,
              end: m.index + m[1].length,
              original: m[1],
              message: `Use "an" before "${nextWord}"`,
              suggestions: [m[1][0] === 'A' ? 'An' : 'an'],
              source: 'rules',
            });
          } else if (article === 'an' && !needsAn) {
            errors.push({
              start: m.index,
              end: m.index + m[1].length + 1,
              original: m[1],
              message: `Use "a" before "${nextWord}"`,
              suggestions: [m[1][0] === 'A' ? 'A' : 'a'],
              source: 'rules',
            });
          }
        }
        return errors;
      },
    },

    // --- CAPITALIZATION AFTER SENTENCE-ENDING PUNCTUATION ---
    {
      name: 'capitalization',
      check(text) {
        const errors = [];
        const re = /[.!?]\s+([a-z])/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          const charIndex = m.index + m[0].length - 1;
          errors.push({
            start: charIndex,
            end: charIndex + 1,
            original: m[1],
            message: 'Capitalize the first letter of a sentence',
            suggestions: [m[1].toUpperCase()],
            source: 'rules',
          });
        }
        return errors;
      },
    },

    // --- DOUBLE SPACES ---
    {
      name: 'double-space',
      check(text) {
        const errors = [];
        const re = /[^\n] {2,}/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          // Include only the spaces (skip the leading char)
          const spaceStart = m.index + 1;
          const spaces = m[0].slice(1);
          errors.push({
            start: spaceStart,
            end: spaceStart + spaces.length,
            original: spaces,
            message: 'Extra spaces detected',
            suggestions: [' '],
            source: 'rules',
          });
        }
        return errors;
      },
    },

    // --- MISSING SPACE AFTER PUNCTUATION ---
    {
      name: 'space-after-punctuation',
      check(text) {
        const errors = [];
        const re = /[,;:][^\s\d\n"')}\]]/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          // Skip URLs (://)
          if (m[0][0] === ':' && text[m.index + 1] === '/') continue;
          // Skip time formats like 10:30
          if (m[0][0] === ':' && /\d/.test(text[m.index - 1] || '')) continue;
          errors.push({
            start: m.index,
            end: m.index + m[0].length,
            original: m[0],
            message: `Add a space after "${m[0][0]}"`,
            suggestions: [m[0][0] + ' ' + m[0][1]],
            source: 'rules',
          });
        }
        return errors;
      },
    },

    // --- COMMON MISSPELLINGS ---
    {
      name: 'misspelling',
      check(text) {
        const errors = [];
        const words = text.matchAll(/\b[a-zA-Z']+\b/g);
        for (const m of words) {
          const lower = m[0].toLowerCase();
          if (MISSPELLINGS[lower]) {
            const correction = MISSPELLINGS[lower];
            // Preserve original case for first letter
            const suggestion = m[0][0] === m[0][0].toUpperCase()
              ? correction.charAt(0).toUpperCase() + correction.slice(1)
              : correction;
            errors.push({
              start: m.index,
              end: m.index + m[0].length,
              original: m[0],
              message: `Did you mean "${suggestion}"?`,
              suggestions: [suggestion],
              source: 'rules',
            });
          }
        }
        return errors;
      },
    },

    // --- COMMON CONFUSIONS: their/there/they're, your/you're, its/it's ---
    {
      name: 'confusion-its',
      check(text) {
        const errors = [];
        // "its" followed by a verb → likely should be "it's"
        const re = /\bits\s+(a|is|was|been|not|the|going|about|time|important|clear|possible|likely|true|false|good|bad|hard|easy)\b/gi;
        let m;
        while ((m = re.exec(text)) !== null) {
          errors.push({
            start: m.index,
            end: m.index + 3,
            original: m[0].slice(0, 3),
            message: 'Did you mean "it\'s" (it is)?',
            suggestions: ["it's"],
            source: 'rules',
          });
        }
        return errors;
      },
    },

    // --- SUBJECT-VERB AGREEMENT (simple cases) ---
    {
      name: 'subject-verb-simple',
      check(text) {
        const errors = [];
        // "I is", "I was" is fine, but "I are" is wrong
        const patterns = [
          { re: /\b(I)\s+(are|is|was not|were)\b/gi, msg: 'Subject-verb agreement', fix: (subj, verb) => verb.toLowerCase() === 'are' ? 'am' : verb },
          { re: /\b(he|she|it)\s+(are|were|have)\b/gi, msg: 'Subject-verb agreement', fix: (subj, verb) => ({ 'are': 'is', 'were': 'was', 'have': 'has' }[verb.toLowerCase()] || verb) },
          { re: /\b(they|we)\s+(is|was|has)\b/gi, msg: 'Subject-verb agreement', fix: (subj, verb) => ({ 'is': 'are', 'was': 'were', 'has': 'have' }[verb.toLowerCase()] || verb) },
          { re: /\b(the\s+\w+)\s+(are|were)\b/gi, msg: null }, // Skip — too ambiguous without knowing if noun is plural
        ];

        for (const p of patterns) {
          if (!p.msg) continue;
          let m;
          while ((m = p.re.exec(text)) !== null) {
            const verbStart = m.index + m[1].length + 1;
            const verb = m[2];
            const fixed = p.fix(m[1], verb);
            if (fixed !== verb.toLowerCase()) {
              errors.push({
                start: verbStart,
                end: verbStart + verb.length,
                original: verb,
                message: p.msg + `: "${m[1]} ${fixed}"`,
                suggestions: [fixed],
                source: 'rules',
              });
            }
          }
        }
        return errors;
      },
    },

    // --- UNCLOSED QUOTES ---
    {
      name: 'unclosed-quotes',
      check(text) {
        const errors = [];
        // Count double quotes per line
        const lines = text.split('\n');
        let offset = 0;
        for (const line of lines) {
          const count = (line.match(/"/g) || []).length;
          if (count % 2 !== 0) {
            const lastQuote = line.lastIndexOf('"');
            errors.push({
              start: offset + lastQuote,
              end: offset + lastQuote + 1,
              original: '"',
              message: 'Unclosed quotation mark',
              suggestions: [],
              source: 'rules',
            });
          }
          offset += line.length + 1; // +1 for \n
        }
        return errors;
      },
    },
  ];

  /**
   * Run all rules against the given text.
   * @param {string} text
   * @returns {{ errors: Array<{start: number, end: number, original: string, message: string, suggestions: string[], source: string}> }}
   */
  function check(text) {
    if (!text || text.length < 2) return { errors: [] };

    const allErrors = [];
    for (const rule of rules) {
      try {
        const errors = rule.check(text);
        allErrors.push(...errors);
      } catch (e) {
        // Silently skip broken rules
        console.warn(`[GC] Rule "${rule.name}" failed:`, e);
      }
    }

    // Sort by position, deduplicate overlapping ranges
    allErrors.sort((a, b) => a.start - b.start || a.end - b.end);
    const deduped = [];
    for (const err of allErrors) {
      const last = deduped[deduped.length - 1];
      if (last && err.start < last.end) continue; // Skip overlapping
      deduped.push(err);
    }

    return { errors: deduped };
  }

  return { check };
})();
