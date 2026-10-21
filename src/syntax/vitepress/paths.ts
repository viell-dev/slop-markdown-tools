const assetExtensions = new Set(
  "3g2,3gp,aac,ai,apng,au,avif,bin,bmp,cer,class,conf,crl,css,csv,dll,doc,eps,epub,exe,gif,gz,ics,ief,jar,jpe,jpeg,jpg,js,json,jsonld,m4a,man,mid,midi,mjs,mov,mp2,mp3,mp4,mpe,mpeg,mpg,mpp,oga,ogg,ogv,ogx,opus,otf,p10,p7c,p7m,p7s,pdf,png,ps,qt,roff,rtf,rtx,ser,svg,t,tif,tiff,tr,ts,tsv,ttf,txt,vtt,wav,weba,webm,webp,woff,woff2,xhtml,xml,yaml,yml,zip".split(
    ",",
  ),
);
/** VitePress's built-in asset suffixes; unknown suffixes still name pages. */
export function vitepressPage(name: string): boolean {
  return !assetExtensions.has(name.split(/[?#]/, 1)[0]!.split(".").at(-1)!.toLowerCase());
}
