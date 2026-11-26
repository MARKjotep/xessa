import styles from "../generated/maps/button.map.js";

/** Illustrative consumer of the generated class map; not part of the Xessa build. */
export function Button() {
  return (
    <button type="button" className={`${styles.button} ${styles.isPrimary}`}>
      Continue
    </button>
  );
}
