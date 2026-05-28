window.SFTIMES_QUIZ = {
    id: 'blood-type',
    eyebrow: 'Blood Type Quiz',
    title: 'What does your blood type say about your morning coffee order?',
    intro: 'The Korean and Japanese personality system that has nothing to do with biology. Twelve questions, four types. Reading list, neighborhood, and coffee order at the end.',
    estimate: '~3 minutes',
    disclaimer: 'For fun, not biology. We are not asking you what your actual blood type is. We are asking you which of the four cultural archetypes you are.',
    scoringMode: 'tally',
    types: ['A','B','AB','O'],
    questions: [
      {
        text: 'Your week is best when...',
        options: [
          { label: 'Everything is on the calendar a week ahead and the calendar held.',                                  type: 'A' },
          { label: 'A new thing came up and you went with it.',                                                            type: 'B' },
          { label: 'You alternated between deeply scheduled and deeply unscheduled days.',                                  type: 'AB' },
          { label: 'You handled three things that came up and showed up for the fourth too.',                               type: 'O' },
        ],
      },
      {
        text: 'On a Sunday morning, your kitchen is...',
        options: [
          { label: 'Clean from the night before. Coffee setup ready. The kettle has water in it.',                          type: 'A' },
          { label: 'Wherever you left it. You will figure out coffee when you wake up.',                                    type: 'B' },
          { label: 'Half organized. The dishes are done but the cookbooks are open on the counter.',                        type: 'AB' },
          { label: 'In motion. You are already making something for whoever comes over later.',                              type: 'O' },
        ],
      },
      {
        text: 'In a group dinner with 8 people you don\'t know well, you...',
        options: [
          { label: 'Sit between two thoughtful people. Listen carefully. Speak when you have something specific.',           type: 'A' },
          { label: 'Tell a story about a thing that happened to you on the way to dinner. Get a laugh.',                     type: 'B' },
          { label: 'Watch the table for the first half hour. Adjust your role based on what is missing.',                    type: 'AB' },
          { label: 'Pick up the conversation that\'s sagging. Ask the person who is being quiet a real question.',           type: 'O' },
        ],
      },
      {
        text: 'You read a long magazine piece. The next thing you do is...',
        options: [
          { label: 'Sit with it. Re-read the part that hit hardest. Underline a sentence.',                                   type: 'A' },
          { label: 'Send it to one specific person with no commentary. They will know why.',                                 type: 'B' },
          { label: 'Take the part that\'s relevant to your work and put it in a note for later.',                            type: 'AB' },
          { label: 'Bring it up at the next dinner. Lead the conversation about it.',                                         type: 'O' },
        ],
      },
      {
        text: 'When you get bad news, the first hour is...',
        options: [
          { label: 'Quiet. You do not want to talk yet. You want to think.',                                                  type: 'A' },
          { label: 'Loud. You feel it. You walk it off. You text three people.',                                              type: 'B' },
          { label: 'Detached. You manage the immediate logistics first. Feelings come at hour three.',                        type: 'AB' },
          { label: 'Practical. You ask what needs to be done. You start doing it.',                                            type: 'O' },
        ],
      },
      {
        text: 'You\'re moving to a new apartment. The unpacking takes...',
        options: [
          { label: 'A weekend. Box by box. The kitchen first because the system needs to work tomorrow.',                       type: 'A' },
          { label: 'A month. The boxes get used as bedside tables.',                                                              type: 'B' },
          { label: 'Two phases. The visible rooms in 48 hours, the closets when you feel like it.',                              type: 'AB' },
          { label: 'A long Saturday with three friends, pizza, and a playlist.',                                                  type: 'O' },
        ],
      },
      {
        text: 'You see a stranger drop their wallet on the sidewalk. You...',
        options: [
          { label: 'Catch up to them quietly. Hand it back. Walk on without making a thing of it.',                              type: 'A' },
          { label: 'Yell after them. Wave. Run. Catch them. Story for the rest of the day.',                                     type: 'B' },
          { label: 'Pick it up, glance at the ID, decide on the most efficient way to return it.',                              type: 'AB' },
          { label: 'Run after them and start a conversation. They\'ll know your name by the next block.',                        type: 'O' },
        ],
      },
      {
        text: 'You\'re asked to give a toast at a wedding. You...',
        options: [
          { label: 'Wrote it three days ago. Practiced it. Edited it twice.',                                                      type: 'A' },
          { label: 'Are still writing it during the salad course.',                                                                 type: 'B' },
          { label: 'Have a rough outline and trust the room to tell you which one to use.',                                        type: 'AB' },
          { label: 'Stand up, look at the couple, and say what you actually feel.',                                                 type: 'O' },
        ],
      },
      {
        text: 'You are stuck in a long line. You...',
        options: [
          { label: 'Wait patiently. Read on your phone. The line is the line.',                                                     type: 'A' },
          { label: 'Strike up a conversation with whoever is in front of you.',                                                     type: 'O' },
          { label: 'Get bored fast. Leave. Try again later.',                                                                       type: 'B' },
          { label: 'Quietly assess the line\'s efficiency. Privately judge the staff.',                                              type: 'AB' },
        ],
      },
      {
        text: 'You disagree with your roommate about something small. You...',
        options: [
          { label: 'Bring it up at a calm time. Use neutral language. Resolve it.',                                                 type: 'A' },
          { label: 'Mention it once. Forget about it. Possibly bring it back up in three weeks.',                                    type: 'B' },
          { label: 'Notice it for two days, then write a careful note about it.',                                                   type: 'AB' },
          { label: 'Knock on their door right now. Talk it out at the kitchen table.',                                              type: 'O' },
        ],
      },
      {
        text: 'In a casual relationship, you usually want...',
        options: [
          { label: 'Slow build. Three or four good dates before deciding anything.',                                                type: 'A' },
          { label: 'Fast and unscripted. See where it goes.',                                                                        type: 'B' },
          { label: 'Honest conversation about what each of us is looking for, then proceed.',                                        type: 'AB' },
          { label: 'A clear yes or a clear no. Decide together. Move forward.',                                                      type: 'O' },
        ],
      },
      {
        text: 'You walk into a small bookstore. The first thing you do is...',
        options: [
          { label: 'Find the staff picks shelf and read every card carefully.',                                                       type: 'A' },
          { label: 'Wander the aisles in a random pattern. Pick up whatever has an interesting cover.',                              type: 'B' },
          { label: 'Browse by section. Have a specific shelf in mind, then drift.',                                                   type: 'AB' },
          { label: 'Ask the bookseller what they\'ve been reading lately.',                                                            type: 'O' },
        ],
      },
    ],    resultsByType: {
      A: { name: 'Type A. The careful one.',
        blurb: 'You set the table on Tuesday for a Friday dinner. Your friends know your apartment is the steadiest place to land. Your coffee order is a single-origin pour-over, milk on the side, paid with the same card at the same place. Your neighborhood is the Inner Sunset, where a quiet Tuesday is its own reward. You read SF Times because we publish on time and we run a corrections page.',
        reads: [
          { title: 'The Outer Richmond Russian bakery passing the recipe to its third owner', href: '/stories/richmond-russian-bakery', note: 'Issue 11' },
          { title: 'The Pacific Heights block where every house has a piano', href: '/stories/pacific-heights-piano-block', note: 'Issue 5' },
          { title: 'Best Coffee in the Peninsula', href: '/best-of/peninsula-coffee', note: 'Best Of' },
        ],
      },
      B: { name: 'Type B. The free spirit.',
        blurb: 'Your week has a shape only you can see. You will text three people about a thing happening tonight at a place you just heard about. Your coffee order is whatever the barista is excited about. Your neighborhood is the Mission or the Outer Sunset, depending on the day. You read SF Times because we describe places you would actually go.',
        reads: [
          { title: 'The Castro record shop that hosts a 30-year poker game on Friday nights', href: '/stories/castro-record-shop-friday', note: 'Issue 3' },
          { title: 'The Sunset surf school for kids who can\'t swim', href: '/stories/sunset-surf-school', note: 'Issue 12' },
          { title: 'Hidden Spots', href: '/hidden-spots', note: 'Reader-submitted' },
        ],
      },
      AB: { name: 'Type AB. The dual citizen.',
        blurb: 'You are organized in the parts of your life you decided to organize, and feral everywhere else. Your friends notice. Your coffee order changes by mood. Your neighborhood is Pacific Heights or Glen Park, depending on whether you are reading a novel or trying to be a person. You read SF Times because we run a stance column once a month and a quiet profile every other week, and you needed both.',
        reads: [
          { title: 'The Outer Sunset photographer who documented every shop owner since 2012', href: '/stories/sunset-shop-photographer', note: 'Issue 8' },
          { title: 'The Mission\'s Last Mariachi Tailor', href: '/stories/mission-mariachi-tailor', note: 'Issue 16' },
          { title: 'The BART conductor who has seen the same passenger every weekday for nine years', href: '/stories/bart-conductor-blue-line', note: 'Issue 6' },
        ],
      },
      O: { name: 'Type O. The host.',
        blurb: 'You will throw a dinner party on a Tuesday. You know the security guard\'s name. You bring people to people. Your coffee order is a large drip with cream, ordered while making eye contact, often shared with someone who walked in behind you. Your neighborhood is wherever there is a couch and an open kitchen. You read SF Times because we name people, and naming people is how you live.',
        reads: [
          { title: 'The Mission community kitchen where everyone eats Wednesday at 3 p.m.', href: '/stories/mission-community-kitchen', note: 'Issue 7' },
          { title: 'The Tenderloin barbershop that became a youth program', href: '/stories/tenderloin-barbershop-youth-program', note: 'Issue 10' },
          { title: 'The Daly City pho shop run by a 19-year-old after her father died', href: '/stories/daly-city-pho-shop', note: 'Issue 9' },
        ],
      },
    },
    resultDisclaimer: 'For fun, not biology. The Korean and Japanese blood-type personality system is cultural folklore, not science. We picked it up because it is fun to argue about with friends.',
  };
