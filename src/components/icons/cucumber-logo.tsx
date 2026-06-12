import { useId, type SVGProps } from "react";

/**
 * cucumber brand logo — 6-petal flower mark on a soft rounded badge.
 * Has its own colors; scales with width/height (e.g. Tailwind `size-*`).
 */
export function CucumberLogo(props: SVGProps<SVGSVGElement>) {
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${name}_${uid}`;
  return (
    <svg
      viewBox="0 0 30 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      {...props}
    >
      <g clipPath={`url(#${id("clip0")})`}>
        <path
          d="M13.8453 0.373455C14.508 0.132226 15.2346 0.132226 15.8974 0.373455L23.4043 3.10577C24.0671 3.347 24.6237 3.81403 24.9764 4.42485L28.9707 11.3433C29.3234 11.9541 29.4496 12.6697 29.3271 13.3643L27.9399 21.2316C27.8174 21.9262 27.4541 22.5555 26.9138 23.0088L20.7941 28.1439C20.2538 28.5973 19.571 28.8458 18.8657 28.8458H10.8769C10.1716 28.8458 9.48887 28.5973 8.94857 28.1439L2.82883 23.0088C2.28853 22.5555 1.92525 21.9262 1.80277 21.2316L0.415537 13.3643C0.293061 12.6697 0.41923 11.9541 0.771884 11.3433L4.76626 4.42485C5.11892 3.81403 5.67551 3.347 6.33828 3.10577L13.8453 0.373455Z"
          fill="#EDF6D9"
        />
        <path
          d="M13.8453 0.373455C14.508 0.132226 15.2346 0.132226 15.8974 0.373455L23.4043 3.10577C24.0671 3.347 24.6237 3.81403 24.9764 4.42485L28.9707 11.3433C29.3234 11.9541 29.4496 12.6697 29.3271 13.3643L27.9399 21.2316C27.8174 21.9262 27.4541 22.5555 26.9138 23.0088L20.7941 28.1439C20.2538 28.5973 19.571 28.8458 18.8657 28.8458H10.8769C10.1716 28.8458 9.48887 28.5973 8.94857 28.1439L2.82883 23.0088C2.28853 22.5555 1.92525 21.9262 1.80277 21.2316L0.415537 13.3643C0.293061 12.6697 0.41923 11.9541 0.771884 11.3433L4.76626 4.42485C5.11892 3.81403 5.67551 3.347 6.33828 3.10577L13.8453 0.373455Z"
          fill={`url(#${id("paint0_radial")})`}
        />
        <g filter={`url(#${id("filter0_i")})`}>
          <path
            d="M14.0166 0.84375C14.5689 0.642782 15.1743 0.642744 15.7266 0.84375L23.2334 3.5752C23.7856 3.77619 24.2491 4.16589 24.543 4.6748L28.5381 11.5938C28.8317 12.1026 28.937 12.6987 28.835 13.2773L27.4473 21.1445C27.3452 21.7233 27.0429 22.2482 26.5928 22.626L20.4727 27.7607C20.0224 28.1385 19.453 28.3457 18.8652 28.3457H10.877C10.2892 28.3457 9.71978 28.1385 9.26953 27.7607L3.15039 22.626C2.70014 22.2482 2.39698 21.7234 2.29492 21.1445L0.908203 13.2773C0.80617 12.6986 0.911316 12.1027 1.20508 11.5938L5.19922 4.6748C5.4931 4.1658 5.95746 3.77622 6.50977 3.5752L14.0166 0.84375Z"
            stroke="#29BF4E"
          />
        </g>
        <g id={id("petal")} data-figma-trr="r6u1.5-0f">
          <g opacity="0.5" filter={`url(#${id("filter1_ii")})`}>
            <path
              d="M17.1172 7.99688C17.1172 9.75718 14.8714 12.8589 14.8714 12.8589C14.8714 12.8589 12.6257 9.75718 12.6257 7.99688C12.6257 6.23658 13.6312 4.80957 14.8714 4.80957C16.1117 4.80957 17.1172 6.23658 17.1172 7.99688Z"
              fill={`url(#${id("paint1_linear")})`}
            />
          </g>
        </g>
        <use
          xlinkHref={`#${id("petal")}`}
          transform="translate(20.3145 -5.44349) rotate(60)"
        />
        <use
          xlinkHref={`#${id("petal")}`}
          transform="translate(35.1859 9.42763) rotate(120)"
        />
        <use
          xlinkHref={`#${id("petal")}`}
          transform="translate(29.7429 29.7422) rotate(-180)"
        />
        <use
          xlinkHref={`#${id("petal")}`}
          transform="translate(9.4284 35.1857) rotate(-120)"
        />
        <use
          xlinkHref={`#${id("petal")}`}
          transform="translate(-5.44304 20.3146) rotate(-60)"
        />
      </g>
      <defs>
        <filter
          id={id("filter0_i")}
          x="0.369954"
          y="0.192383"
          width="29.0027"
          height="28.9533"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="BackgroundImageFix"
            result="shape"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="0.5" />
          <feGaussianBlur stdDeviation="0.15" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.654902 0 0 0 0 0.854902 0 0 0 0 0.388235 0 0 0 1 0"
          />
          <feBlend
            mode="normal"
            in2="shape"
            result="effect1_innerShadow"
          />
        </filter>
        <filter
          id={id("filter1_ii")}
          x="12.6257"
          y="3.80957"
          width="4.99146"
          height="9.54932"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="BackgroundImageFix"
            result="shape"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="-1" />
          <feGaussianBlur stdDeviation="0.75" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.44 0"
          />
          <feBlend
            mode="normal"
            in2="shape"
            result="effect1_innerShadow"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dx="0.5" dy="0.5" />
          <feGaussianBlur stdDeviation="0.25" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.39 0"
          />
          <feBlend
            mode="normal"
            in2="effect1_innerShadow"
            result="effect2_innerShadow"
          />
        </filter>
        <radialGradient
          id={id("paint0_radial")}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(14.8713 14.8713) rotate(90) scale(14.8713)"
        >
          <stop offset="0.75" stopColor="#EDF6D9" />
          <stop offset="1" stopColor="#CFE996" />
        </radialGradient>
        <linearGradient
          id={id("paint1_linear")}
          x1="14.8714"
          y1="5.96224"
          x2="14.8714"
          y2="10.9709"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#A7DA63" />
          <stop offset="1" stopColor="#35C150" />
        </linearGradient>
        <clipPath id={id("clip0")}>
          <rect width="29.7426" height="29.7426" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

/**
 * Inverted variant kept for API compatibility. The brand mark already sits on a
 * light badge that reads well on dark backgrounds, so it renders the same logo.
 */
export function CucumberLogoInverted(props: SVGProps<SVGSVGElement>) {
  return <CucumberLogo {...props} />;
}
