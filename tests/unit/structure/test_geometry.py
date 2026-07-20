from vasp_analyzer.core import SelectiveMask, Site
from vasp_analyzer.structure.bonds import periodic_bonds
from vasp_analyzer.structure.supercell import replicate_sites

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
MASK = SelectiveMask(x=True, y=True, z=True)
SITES = (
    Site(site_index=0, element="H", initial_fractional_position=(0.95, 0.0, 0.0), initial_cartesian_position=(0.95, 0.0, 0.0), selective_dynamics=MASK),
    Site(site_index=1, element="H", initial_fractional_position=(0.05, 0.0, 0.0), initial_cartesian_position=(0.05, 0.0, 0.0), selective_dynamics=MASK),
)


def test_supercell_images_keep_original_identity() -> None:
    images = replicate_sites(SITES, repeat=(2, 1, 1))
    assert [(image.site_index, image.image) for image in images] == [
        (0, (0, 0, 0)), (1, (0, 0, 0)), (0, (1, 0, 0)), (1, (1, 0, 0))
    ]
    assert images[2].fractional_position == (0.975, 0.0, 0.0)


def test_periodic_bond_records_minimum_image_identity() -> None:
    (bond,) = periodic_bonds(SITES, IDENTITY, cutoff=0.11)
    assert (bond.site_index, bond.neighbor_site_index, bond.neighbor_image) == (0, 1, (1, 0, 0))
    assert abs(bond.distance - 0.1) < 1e-12


def test_periodic_bond_handles_unwrapped_fractional_positions() -> None:
    unwrapped = (
        SITES[0].model_copy(update={"initial_fractional_position": (2.95, 0.0, 0.0)}),
        SITES[1],
    )

    (bond,) = periodic_bonds(unwrapped, IDENTITY, cutoff=0.11)

    assert bond.neighbor_image == (3, 0, 0)
    assert abs(bond.distance - 0.1) < 1e-12
