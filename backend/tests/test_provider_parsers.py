from app.data.providers.hems import _parse_records
from app.data.providers.html_utils import soup_for, table_records
from app.data.providers.mbs import _find_population_candidate


def test_hems_parser_preserves_official_fields() -> None:
    html = b"""
    <table>
      <tbody>
        <tr class="est-row" onclick="toggleProfessionals(this, 42)">
          <td>Example Health Centre</td>
          <td>Ministry of Health</td>
          <td>Health Centre Grade 2</td>
          <td>REG-42</td>
          <td>LIC-42</td>
          <td>123456</td>
          <td>example@example.invalid</td>
        </tr>
      </tbody>
    </table>
    """

    records = _parse_records(html)

    assert records == [
        {
            "establishment_id": "42",
            "name": "Example Health Centre",
            "owner": "Ministry of Health",
            "facility_level": "Health Centre Grade 2",
            "registration_number": "REG-42",
            "license_number": "LIC-42",
            "contact": "123456",
            "email": "example@example.invalid",
            "status": "open",
            "island_text": "",
        }
    ]


def test_mbs_p5_parser_emits_sex_and_nationality_rows() -> None:
    import pandas as pd

    from app.data.normalize.normalizer import _parse_p5_rows

    frame = pd.DataFrame(
        [
            ["Table P5"],
            [None],
            [
                "Atoll",
                "Island",
                "Population",
                None,
                None,
                "Maldivian",
                None,
                None,
                "Foreign",
                None,
                None,
            ],
            [
                None,
                None,
                "Both Sexes",
                "Female",
                "Male",
                "Both Sexes",
                "Female",
                "Male",
                "Both Sexes",
                "Female",
                "Male",
            ],
            ["(1)", "(2)"],
            ["HA", "Example", 100, 55, 45, 80, 44, 36, 20, 11, 9],
        ]
    )

    rows = _parse_p5_rows(frame)

    assert len(rows) == 9
    assert {row["nationality"] for row in rows} == {"total", "Maldivian", "foreign"}
    assert {row["sex"] for row in rows} == {"both", "female", "male"}
    assert (
        next(row for row in rows if row["nationality"] == "total" and row["sex"] == "both")[
            "population"
        ]
        == 100
    )

    import pandas as pd

    from app.data.normalize.normalizer import _parse_p6_rows

    frame = pd.DataFrame(
        [
            ["Table P6", None, None, None, None, None, None, None, None, None],
            [None] * 10,
            [
                "Locality",
                "Resident Population 2022",
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ],
            [None, "Total", None, None, "Maldivians", None, None, "Foreigners", None, None],
            [
                "Age",
                "Both sexes",
                "Male",
                "Female",
                "Both sexes",
                "Male",
                "Female",
                "Both sexes",
                "Male",
                "Female",
            ],
            [None] * 10,
            ["Example", None, None, None, None, None, None, None, None, None],
            ["All ages", 100, 50, 50, 80, 40, 40, 20, 10, 10],
            ["5-9", 20, 11, 9, 16, 9, 7, 4, 2, 2],
        ]
    )

    rows = _parse_p6_rows(frame)

    assert rows == [
        {
            "locality": "Example",
            "age_group": "5-9",
            "sex": "both",
            "nationality": "total",
            "population": 20,
        },
        {
            "locality": "Example",
            "age_group": "5-9",
            "sex": "male",
            "nationality": "total",
            "population": 11,
        },
        {
            "locality": "Example",
            "age_group": "5-9",
            "sex": "female",
            "nationality": "total",
            "population": 9,
        },
        {
            "locality": "Example",
            "age_group": "5-9",
            "sex": "both",
            "nationality": "maldivian",
            "population": 16,
        },
        {
            "locality": "Example",
            "age_group": "5-9",
            "sex": "male",
            "nationality": "maldivian",
            "population": 9,
        },
        {
            "locality": "Example",
            "age_group": "5-9",
            "sex": "female",
            "nationality": "maldivian",
            "population": 7,
        },
        {
            "locality": "Example",
            "age_group": "5-9",
            "sex": "both",
            "nationality": "foreign",
            "population": 4,
        },
        {
            "locality": "Example",
            "age_group": "5-9",
            "sex": "male",
            "nationality": "foreign",
            "population": 2,
        },
        {
            "locality": "Example",
            "age_group": "5-9",
            "sex": "female",
            "nationality": "foreign",
            "population": 2,
        },
    ]


def test_mbs_candidate_finds_island_and_2022_population_columns() -> None:
    import pandas as pd

    frame = pd.DataFrame(
        [
            ["Table P3"],
            ["Island", "Resident Population 2022"],
            ["Example", 123],
        ]
    )

    candidate = _find_population_candidate(frame, "P3")

    assert candidate == {
        "sheet": "P3",
        "header_row": 1,
        "island_column": 0,
        "atoll_column": None,
        "population_2022_column": 1,
    }


def test_html_table_parser_maps_headers_to_values() -> None:
    html = b"<table><tr><th>Name</th><th>Code</th></tr><tr><td>A</td><td>1</td></tr></table>"
    soup = soup_for(html)

    assert table_records(soup) == [{"name": "A", "code": "1"}]


def test_html_table_parser_supports_bold_td_headers() -> None:
    html = (
        b"<table><tr><td><b>Name</b></td><td><b>Code</b></td></tr>"
        b"<tr><td>A</td><td>1</td></tr></table>"
    )
    soup = soup_for(html)

    assert table_records(soup) == [{"name": "A", "code": "1"}]
