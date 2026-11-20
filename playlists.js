/* ============================================================
   THE SEASON ARCHIVE: the one list every page reads.

   Each new season: add one line, commit, done.
     - season: 'Spring' | 'Summer' | 'Fall' | 'Winter'
     - year:   the calendar year (Winter 2012 = the winter that starts Dec 2012)
     - id:     the Spotify playlist ID (the part after /playlist/ in the URL,
               before any "?si=")

   Order doesn't matter; the pages sort it themselves.
   Used by index.html and season-puller.html.
   ============================================================ */
window.SEASON_PLAYLISTS = [
    { season: 'Fall',   year: 2011, id: '5wkv11CBSWffCPxSlmjFrm' },
    { season: 'Winter', year: 2011, id: '0uffa0ij52lKItCT1mb0e3' },

    { season: 'Spring', year: 2012, id: '6JAdNM4Jx8tZaaeHLhtBhx' },
    { season: 'Summer', year: 2012, id: '4gxLwaN1z1wQlKXs7v9k7U' },
    { season: 'Fall',   year: 2012, id: '3iCUFWzBucminmnMY4a1db' },
    { season: 'Winter', year: 2012, id: '0pvrzhK3FJIsdkKQG8imF8' },

    { season: 'Spring', year: 2013, id: '6zMs8v7MZ5j0UtOCV5MiBC' },
    { season: 'Summer', year: 2013, id: '4sRg33XW5HJP9HtBzQmq3N' },
    { season: 'Fall',   year: 2013, id: '41hKSL2bBoU5mG7CCnCNx9' },
    { season: 'Winter', year: 2013, id: '7hCn4W8HuCJI4DLSWCZfVI' },

    { season: 'Spring', year: 2014, id: '73PgN6KZaaUarmSi9xUYwU' },
    { season: 'Summer', year: 2014, id: '1TXhfMe8aIUet3RIHbrF3u' },
    { season: 'Fall',   year: 2014, id: '17EAkVWcc7ePwqwbmkOxRT' },
    { season: 'Winter', year: 2014, id: '5L6OjPmlqD4kPpjCGhezzc' },

    { season: 'Spring', year: 2015, id: '54lnhZxgXBQfCQWjJ59JTv' },
    { season: 'Summer', year: 2015, id: '2ruxkGLijjlONpGxX69Dpp' },
    { season: 'Fall',   year: 2015, id: '4OXyGepBUFaonEriAPGk39' },
    { season: 'Winter', year: 2015, id: '25ejfMmlChJLvsAm1RsVVL' },

    { season: 'Spring', year: 2016, id: '5GzUocM5hM3jyxZj7el58e' },
    { season: 'Summer', year: 2016, id: '6TfSbAgQ4aXv5ncameTgGt' },
    { season: 'Fall',   year: 2016, id: '2VCpvOwfRXaXNmNAuuUNnR' },
    { season: 'Winter', year: 2016, id: '1Pirv0DkTWfCZldNPgvA7R' },

    { season: 'Spring', year: 2017, id: '04moCSJfuZjofSIGQw5OxZ' },
    { season: 'Summer', year: 2017, id: '7G96fwgseT18ZIKnvdCIQz' },
    { season: 'Fall',   year: 2017, id: '2bPMg8g3PpbfDUqAh38Ims' },
    { season: 'Winter', year: 2017, id: '3EIcxi1XQyxOa2y6h9L6Jz' },

    { season: 'Spring', year: 2018, id: '3vs9ee42tbNkg1ZpjAP4ah' },
    { season: 'Summer', year: 2018, id: '0GzRb3EcvOZYKTja7JnKUs' },
    { season: 'Fall',   year: 2018, id: '63NxD6r948F6WN7FKCPJZ9' },
    { season: 'Winter', year: 2018, id: '0AQaGnMY4PQeQEVmrBM7H9' },

    { season: 'Spring', year: 2019, id: '3MqSGtsrxvX1BZ3pQPuX1Y' },
    { season: 'Summer', year: 2019, id: '5Me25nOyHbEIK3GwytrSlN' },
    { season: 'Fall',   year: 2019, id: '6eh9jT4ACAsF3e1yayHZHe' },
    { season: 'Winter', year: 2019, id: '3fF5aLdvWYGt7Y0XpnRQeI' },

    { season: 'Spring', year: 2020, id: '4eynm41wEY7KfzZ2B4QhCW' },
    { season: 'Summer', year: 2020, id: '6KKUycI4JBZEYUSOECnx6K' },
    { season: 'Fall',   year: 2020, id: '45fHyjB4l3m1bQeV1UrEwz' },
    { season: 'Winter', year: 2020, id: '3osvLVuhNtuWJhc1iIQq6j' },

    { season: 'Spring', year: 2021, id: '6SBWtDuGnBFVCVHdZrmenp' },
    { season: 'Summer', year: 2021, id: '6mbD8Tkqvpa0iZlQpJMmR2' },
    { season: 'Fall',   year: 2021, id: '54V2ayQiVmZ3deUYBkei4A' },
    { season: 'Winter', year: 2021, id: '0HAREzZTmiUISlUAUuYJLw' },

    { season: 'Spring', year: 2022, id: '79usfWZaKTLhAaiObjRrkW' },
    { season: 'Summer', year: 2022, id: '5zGFPRiksctWQU2k5gskNQ' },
    { season: 'Fall',   year: 2022, id: '6bojseXbCFR8YrAcQbLEXl' },
    { season: 'Winter', year: 2022, id: '3vys1Oq5HFkvIsDu2anFTt' },

    { season: 'Spring', year: 2023, id: '1f1X3zUsv4CAgevHR6hDO4' },
    { season: 'Summer', year: 2023, id: '6RpHmjOSaQvPAkMK8wZwxa' },
    { season: 'Fall',   year: 2023, id: '19eKq0jBuuNT6DKdUThLO3' },
    { season: 'Winter', year: 2023, id: '3U5YromjgGtsNM4CcstnQK' },

    { season: 'Spring', year: 2024, id: '2EKl0jmbX7Xqz0b3qvnr8J' },
    { season: 'Summer', year: 2024, id: '4vL01VOXqWeu9OwBq2DWUa' },
    { season: 'Fall',   year: 2024, id: '3T9dYu5nFqASmhzQ3wvg98' },
    { season: 'Winter', year: 2024, id: '2YWEQ8CbYLYoeRpE4I3UT6' },

    { season: 'Spring', year: 2025, id: '4b0n2eJxzwgWIYO8YkRoMf' },
    { season: 'Summer', year: 2025, id: '1MWYo2ohgTteRAA8cbbqsU' },
    { season: 'Fall',   year: 2025, id: '2cNDAxPUFPFud0gOxgOFEg' },
    { season: 'Winter', year: 2025, id: '2xsb8t6f9Zbl9k1ZkqCSSg' },

    { season: 'Spring', year: 2026, id: '0Q0vYgP2PyBtqLq2EonVS0' },
    { season: 'Summer', year: 2026, id: '2H7WgezNfuDizPqDX7lmMb' },
    { season: 'Fall',   year: 2026, id: '2w3QJpOhUv0K28TsMM1WnG' },
];
