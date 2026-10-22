/** CSB verses on provision, kept in the repo so no page render depends on the network. */
export const CSB_VERSES = {
  "Matthew 6:11": "Give us today our daily bread.",
  "Psalm 145:15-16":
    "All eyes look to you, and you give them their food at the proper time. You open your hand and satisfy the desire of every living thing.",
  "Genesis 22:14":
    "And Abraham named that place The LORD Will Provide, so today it is said, “It will be provided on the LORD’s mountain.”",
  "Philippians 4:19":
    "And my God will supply all your needs according to his riches in glory in Christ Jesus.",
  "1 Timothy 6:17":
    "Instruct those who are rich in the present age not to be arrogant or to set their hope on the uncertainty of wealth, but on God, who richly provides us with all things to enjoy.",
  "Psalm 23:1": "The LORD is my shepherd; I have what I need.",
  "Exodus 16:4":
    "Then the LORD said to Moses, “I am going to rain bread from heaven for you. The people are to go out each day and gather enough for that day. This way I will test them to see whether or not they will follow my instructions.",
} as const;

export type VerseReference = keyof typeof CSB_VERSES;

/** The credit line the CSB's quotation permission requires, from csbible.com/about-the-csb/permissions. */
export const CSB_NOTICE =
  "Scripture quotations marked CSB have been taken from the Christian Standard Bible®, Copyright © 2017 by Holman Bible Publishers. Used by permission. Christian Standard Bible® and CSB® are federally registered trademarks of Holman Bible Publishers.";
