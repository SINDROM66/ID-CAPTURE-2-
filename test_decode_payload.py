import base91
data = b'kz$!.ZWBds6wzw]7z(qSS]):HAZit!Kd*$+9V.q`tW@,_l]xY0AYiM%iET_M"okEcYXY{yY4K4^RZc!r^3m,6?Qej<.,=KtB(`nVEQt`hz!E_lvN1HDTgKM7RuO!J$z+ZhG6Rz4_87BDHh;>QU:%/WnIkmmsYg#d>dd:u]g22k9u>3{hp9K3s&`b$cP*n#c(.^*U&G!DO`$;62.[:VXuS>0O"T5phX}RE>tT5>aKa3M[|K~,zM3cYP;Nf0&#gHiR60Zze:nx96Oh1>7tkr;MBq%09`fMJ(eG~uz.<!ag."k$(9kKVCKU0c%*VRfz.>$4Iu5:1zR]h23IMX7ynoJ(ho=1H)Htp~rj(|2?v:5x2K9JDgDB#U.+P>[44psnjJK/hj`$Sz5n25*g8YDB^fZ5ES8bk&M8+Mp?Lbd8S9mRVW]zUUv,Rqm!^i#;n.cpyVk*Zb_}Hh_yXs~{bF<nN7/&W3d&$R{)g)of#`S8mQIB&EVVOdEqhg(1!1(;cr~7BOy@=_U<KQI/8`{P]Z2%o@)^zF43jWT7fa]niaAmUS&6t)h2p69#0X#|__i{Ym3gUH:h&Q/k%DRZQvl:D(&{p^5X^@O!A{$D<ic0rt,kF4Nq@=+`:XXZ</c$ee3T[;x=XxXK92S6_N#wcasoqOln}6s^@}Zoqt^G=b);4G>YSOrh<rDJ.WJWOv|+m;,.Ek|^sVC$d9`ueu~_i2Ot.NSv3.+V<b=nd.S|sN09|]*u:px(QFR4Y[7$(9aUd!P!q+y[L8ihW6t?Y[PSImY+=fN/8A:fv1tpA|.U>Ttrq/zE>;9cDKU<Baa%UIB`!lsWCq|x5{%ECOS4;rts}~P6Ar.%lQmXZHOx;`~nx!"/InM=Fk1oF1r*eS+Y!!^}QljF0|/s,nr(Pg|s2}w=>{?)<@78S~6h4F'

dec = base91.decode(data.decode('ascii'))
print("Hex:", bytes(dec[:64]).hex())
print("ASCII repr:", repr(bytes(dec[:64])))
