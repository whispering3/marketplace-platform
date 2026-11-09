-- OLYMPUS: SANCTUM GRID - DOMAIN REGISTRATION (SQL)
-- Registration of the Primary Domain and the 5 Mirror Shield Nodes.

DELETE FROM "PublicMirror";

INSERT INTO "PublicMirror" ("id", "url", "status", "isPrimary", "createdAt")
VALUES
('pm_primary', 'olympusig46s7r64sjgspvkgbry4qfmjv5lechnzmjmdtzhzjrfjwkid.onion', 'ONLINE', true, NOW()),
('pm_m1', 'olympumcyjmepe5nb2bhw6dxe3tzpqh56idbx356cy2axg6xvjvc3xid.onion', 'ONLINE', false, NOW()),
('pm_m2', 'olympumdp6w4dh6gawwp7on654xqyozvy4nesikfzohks73vw6prt7qd.onion', 'ONLINE', false, NOW()),
('pm_m3', 'olympumegy7prameqdydiyvx74fan5lju6qduekdlapihbxibe7ngad.onion', 'ONLINE', false, NOW()),
('pm_m4', 'olympumzizietfa5jked6jlp2t3arppa5pstrwr4lavdfmgfu3gbjid.onion', 'ONLINE', false, NOW()),
('pm_m5', 'olympumyuwkysaghjsispxvp4hgzlirzwacqwd2himad44kp2j6lstid.onion', 'ONLINE', false, NOW());
